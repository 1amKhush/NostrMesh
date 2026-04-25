#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_cmd docker
require_cmd curl
require_cmd jq
require_root_compose

for required in nostrmesh-vpn nostrmesh-relay nostrmesh-blossom nostrmesh-api; do
  if ! docker ps --format '{{.Names}}' | grep -qx "${required}"; then
    echo "[mesh-test] ${required} container is not running. Start stack first with scripts/stack-up.sh" >&2
    exit 1
  fi
done

tunnel_ip="$(${SCRIPT_DIR}/discover-tunnel-ip.sh || true)"
if [[ -z "${tunnel_ip}" ]]; then
  echo "[mesh-test] failed to discover nostr-vpn tunnel IP" >&2
  exit 1
fi

relay_mesh_http="http://${tunnel_ip}:8008"
blossom_mesh_http="http://${tunnel_ip}:3000"
api_local="${API_HTTP_URL}"

overall=0

print_row() {
  local name="$1"
  local status="$2"
  local detail="$3"
  printf '%-24s %-8s %s\n' "${name}" "${status}" "${detail}"
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

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file}" | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${file}" | awk '{print $1}'
    return
  fi

  echo "Missing sha256sum/shasum command" >&2
  exit 1
}

echo "NostrMesh mesh test"
echo "------------------"
check_http "relay-local" "${RELAY_HTTP_URL}" 'Accept: application/nostr+json'
check_http "blossom-local" "${BLOSSOM_HTTP_URL}/health"
check_http "api-local" "${api_local}/health"
check_http "relay-mesh" "${relay_mesh_http}" 'Accept: application/nostr+json'
check_http "blossom-mesh" "${blossom_mesh_http}/health"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

input_file="${tmp_dir}/mesh-test-input.txt"
download_file="${tmp_dir}/mesh-test-output.txt"
upload_body="${tmp_dir}/upload.json"

printf 'nostrmesh mesh test %s\n' "$(date +%s)" > "${input_file}"

upload_code="$(curl -sS -o "${upload_body}" -w '%{http_code}' \
  -F "file=@${input_file};type=text/plain" \
  -F "folder=/mesh-test" \
  "${api_local}/blobs")"

if [[ "${upload_code}" != "201" ]]; then
  print_row "api-upload" "FAIL" "status=${upload_code}"
  cat "${upload_body}" >&2
  exit 1
fi

blob_hash="$(jq -r '.hash // empty' "${upload_body}")"
metadata_server="$(jq -r '.metadata.server // empty' "${upload_body}")"
expected_server="http://${tunnel_ip}:3000"

if [[ "${metadata_server}" == "${expected_server}" ]]; then
  print_row "metadata-server" "OK" "${metadata_server}"
else
  print_row "metadata-server" "FAIL" "expected=${expected_server} actual=${metadata_server}"
  overall=1
fi

curl -sS -o "${download_file}" "${api_local}/blobs/${blob_hash}/download"

input_sha="$(sha256_file "${input_file}")"
output_sha="$(sha256_file "${download_file}")"
if [[ "${input_sha}" == "${output_sha}" ]]; then
  print_row "blob-roundtrip" "OK" "sha256=${output_sha}"
else
  print_row "blob-roundtrip" "FAIL" "input=${input_sha} output=${output_sha}"
  overall=1
fi

if [[ ${overall} -eq 0 ]]; then
  echo "[mesh-test] PASS"
else
  echo "[mesh-test] FAIL"
fi

exit "${overall}"
