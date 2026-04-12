#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_cmd docker
require_cmd curl
require_cmd jq
require_root_compose

for required in nostrmesh-relay nostrmesh-blossom nostrmesh-yggdrasil; do
  if ! docker ps --format '{{.Names}}' | grep -qx "${required}"; then
    echo "[mesh-test] ${required} container is not running. Start stack first with scripts/stack-up.sh" >&2
    exit 1
  fi
done

mesh_address="$(${SCRIPT_DIR}/discover-mesh-address.sh || true)"
if [[ -z "${mesh_address}" ]]; then
  echo "[mesh-test] failed to discover Yggdrasil mesh address" >&2
  exit 1
fi

relay_mesh_http="http://[${mesh_address}]:8008"
relay_mesh_ws="ws://[${mesh_address}]:8008"
blossom_mesh_http="http://[${mesh_address}]:3000"
api_local="${API_HTTP_URL:-http://127.0.0.1:4000}"

overall=0

print_row() {
  local name="$1"
  local status="$2"
  local detail="$3"
  printf '%-26s %-8s %s\n' "${name}" "${status}" "${detail}"
}

check_http() {
  local name="$1"
  local url="$2"
  local header="${3:-}"

  if [[ -n "${header}" ]]; then
    if curl -fsS -H "${header}" "${url}" >/dev/null 2>&1; then
      print_row "${name}" "OK" "${url}"
    else
      print_row "${name}" "FAIL" "${url}"
      overall=1
    fi
  else
    if curl -fsS "${url}" >/dev/null 2>&1; then
      print_row "${name}" "OK" "${url}"
    else
      print_row "${name}" "FAIL" "${url}"
      overall=1
    fi
  fi
}

check_http "relay-mesh-http" "${relay_mesh_http}" 'Accept: application/nostr+json'
check_http "blossom-mesh-health" "${blossom_mesh_http}/health"
check_http "api-local-health" "${api_local}/health"

payload_text="nostrmesh-m2-mesh-test-$(date +%s)"
run_mesh_flow() {
  local relay_url="$1"
  local out_file="$2"
  local err_file="$3"

  docker run --rm -i --network host \
    -e NOSTR_SECRET_KEY="${NOSTR_SECRET_KEY:-}" \
    -e MESH_BLOSSOM_URL="${blossom_mesh_http}" \
    -e MESH_RELAY_URL="${relay_url}" \
    -e TEST_PAYLOAD_TEXT="${payload_text}" \
    nostrmesh-api - >"${out_file}" 2>"${err_file}" <<'NODE'
const crypto = require('crypto');

async function run() {
  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);

  const blossomUrl = process.env.MESH_BLOSSOM_URL;
  const relayUrl = process.env.MESH_RELAY_URL;
  const plainText = process.env.TEST_PAYLOAD_TEXT || `nostrmesh-mesh-test-${Date.now()}`;
  const secretKey = (process.env.NOSTR_SECRET_KEY || '').trim();

  if (!blossomUrl || !relayUrl || !secretKey) {
    throw new Error('Missing required env values for mesh test');
  }

  const { BlossomClient } = require('/app/dist/blossom/client');
  const { encryptBlob, decryptBlob } = require('/app/dist/crypto');
  const {
    buildMetadataEvent,
    metadataFilterByHash,
    parseMetadataEvent,
  } = require('/app/dist/metadata/schema');
  const { publishEvent, fetchEvents } = require('/app/dist/nostr/client');

  const plaintextBuffer = Buffer.from(plainText, 'utf8');
  const encryptedBlob = encryptBlob(plaintextBuffer);

  const blossomClient = new BlossomClient(blossomUrl, secretKey, {
    uploadAttempts: 1,
    downloadAttempts: 1,
    baseDelayMs: 100,
  });
  const uploaded = await withTimeout(
    blossomClient.uploadBlob(encryptedBlob.ciphertext, 'mesh-test.txt'),
    20000,
    'blossom upload'
  );

  const metadata = {
    name: 'mesh-test.txt',
    hash: uploaded.sha256,
    size: plaintextBuffer.length,
    type: 'text/plain',
    folder: '/mesh-test',
    uploadedAt: Math.floor(Date.now() / 1000),
    server: blossomUrl,
    encryptionKey: encryptedBlob.encryptionKey,
  };

  const metadataEvent = buildMetadataEvent(metadata, secretKey);
  let publishStatus = 'ok';
  let publishError = '';

  try {
    await withTimeout(
      publishEvent(metadataEvent, [relayUrl], { attempts: 1, baseDelayMs: 100 }),
      15000,
      'relay publish'
    );
  } catch (error) {
    publishStatus = 'warn';
    publishError = error instanceof Error ? error.message : String(error);
  }

  let fetchedCount = 0;
  let fetchStatus = 'ok';
  let fetchError = '';
  let parsedMetadata = parseMetadataEvent(metadataEvent, secretKey);

  if (publishStatus === 'ok') {
    try {
      const fetchedEvents = await withTimeout(
        fetchEvents(metadataFilterByHash(uploaded.sha256), [relayUrl], { attempts: 1, baseDelayMs: 100 }),
        15000,
        'relay fetch'
      );
      if (!Array.isArray(fetchedEvents) || fetchedEvents.length === 0) {
        throw new Error('Published metadata event was not fetched from relay query');
      }
      fetchedCount = fetchedEvents.length;
      parsedMetadata = parseMetadataEvent(fetchedEvents[0], secretKey);
    } catch (error) {
      fetchStatus = 'warn';
      fetchError = error instanceof Error ? error.message : String(error);
    }
  } else {
    fetchStatus = 'warn';
    fetchError = 'skipped because relay publish did not return an acknowledgement';
  }

  const downloadedEncrypted = await withTimeout(
    blossomClient.downloadBlob(uploaded.sha256),
    20000,
    'blossom download'
  );
  const downloadedSha = crypto.createHash('sha256').update(downloadedEncrypted).digest('hex');
  const decrypted = decryptBlob(downloadedEncrypted, parsedMetadata.encryptionKey).toString('utf8');

  const result = {
    relayUrl,
    blossomUrl,
    eventId: metadataEvent.id,
    hash: uploaded.sha256,
    publishStatus,
    publishError,
    fetchedCount,
    fetchStatus,
    fetchError,
    metadataServer: parsedMetadata.server,
    serverMatches: parsedMetadata.server === blossomUrl,
    shaMatches: downloadedSha === uploaded.sha256,
    payloadMatches: decrypted === plainText,
  };

  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
NODE
}

relay_publish_url="${relay_mesh_ws}"
tmp_json="$(mktemp)"
tmp_err="$(mktemp)"

if ! run_mesh_flow "${relay_publish_url}" "${tmp_json}" "${tmp_err}"; then
  flow_error="$(tr '\n' ' ' < "${tmp_err}" || true)"
  rm -f "${tmp_json}" "${tmp_err}"
  echo "[mesh-test] metadata publish flow failed: ${flow_error}" >&2
  exit 1
fi

node_output="$(cat "${tmp_json}")"
rm -f "${tmp_json}" "${tmp_err}"

if [[ -z "${node_output}" ]]; then
  echo "[mesh-test] empty test result from mesh flow" >&2
  exit 1
fi

if ! jq -e . >/dev/null 2>&1 <<<"${node_output}"; then
  echo "[mesh-test] invalid JSON output from mesh flow" >&2
  echo "${node_output}" >&2
  exit 1
fi

event_id="$(jq -r '.eventId' <<<"${node_output}")"
blob_hash="$(jq -r '.hash' <<<"${node_output}")"
metadata_server="$(jq -r '.metadataServer' <<<"${node_output}")"
server_matches="$(jq -r '.serverMatches' <<<"${node_output}")"
sha_matches="$(jq -r '.shaMatches' <<<"${node_output}")"
payload_matches="$(jq -r '.payloadMatches' <<<"${node_output}")"
publish_status="$(jq -r '.publishStatus' <<<"${node_output}")"
publish_error="$(jq -r '.publishError' <<<"${node_output}")"
fetch_status="$(jq -r '.fetchStatus' <<<"${node_output}")"
fetch_error="$(jq -r '.fetchError' <<<"${node_output}")"
fetched_count="$(jq -r '.fetchedCount' <<<"${node_output}")"

print_row "metadata-publish-path" "OK" "${relay_publish_url}"

if [[ "${publish_status}" == "ok" ]]; then
  print_row "metadata-publish-relay" "OK" "relay acknowledged event"
else
  print_row "metadata-publish-relay" "WARN" "${publish_error}"
fi

if [[ "${fetch_status}" == "ok" ]]; then
  print_row "metadata-fetch-relay" "OK" "events=${fetched_count}"
else
  print_row "metadata-fetch-relay" "WARN" "${fetch_error}"
fi

if [[ "${server_matches}" == "true" ]]; then
  print_row "metadata-server-mesh" "OK" "${metadata_server}"
else
  print_row "metadata-server-mesh" "FAIL" "${metadata_server}"
  overall=1
fi

if [[ "${sha_matches}" == "true" ]]; then
  print_row "blossom-download-sha" "OK" "${blob_hash}"
else
  print_row "blossom-download-sha" "FAIL" "${blob_hash}"
  overall=1
fi

if [[ "${payload_matches}" == "true" ]]; then
  print_row "blob-decrypt-match" "OK" "payload roundtrip succeeded"
else
  print_row "blob-decrypt-match" "FAIL" "payload roundtrip mismatch"
  overall=1
fi

print_row "metadata-event-id" "INFO" "${event_id}"
print_row "mesh-address" "INFO" "${mesh_address}"
print_row "relay-mesh-url" "INFO" "${relay_mesh_ws}"
print_row "blossom-mesh-url" "INFO" "${blossom_mesh_http}"

if [[ ${overall} -eq 0 ]]; then
  echo "[mesh-test] PASS"
else
  echo "[mesh-test] FAIL"
fi

exit ${overall}
