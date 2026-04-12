/* eslint-disable no-console */

import {
  apiBaseUrl,
  assert,
  assertError,
  isKnownRelayFailure,
  logSkip,
  requestBinary,
  requestJson,
  runtimeProcess,
  sha256Hex,
} from "./helpers";

const API_BASE = apiBaseUrl();

function buildPayload(): { form: FormData; plainBytes: Uint8Array } {
  const content = `nostrmesh-e2e-flow-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const plainBytes = new TextEncoder().encode(content);
  const blob = new Blob([plainBytes], { type: "text/plain" });

  const form = new FormData();
  form.append("file", blob, "e2e-flow.txt");
  form.append("folder", "/integration/e2e");

  return { form, plainBytes };
}

async function main(): Promise<void> {
  const health = await requestJson(API_BASE, "/health");
  assert(health.status === 200, `health check failed: ${health.status} ${health.text}`);

  const { form, plainBytes } = buildPayload();
  const expectedPlainSha = await sha256Hex(plainBytes);
  const idempotencyKey = `nostrmesh-e2e-${Date.now()}`;

  const upload = await requestJson(API_BASE, "/blobs", {
    method: "POST",
    headers: {
      "Idempotency-Key": idempotencyKey,
    },
    body: form,
  });

  if (isKnownRelayFailure(upload)) {
    logSkip("e2e-flow", "external relay publish issue (All promises were rejected)");
  }

  assert(upload.status === 201, `upload failed: ${upload.status} ${upload.text}`);

  const hash = String(upload.body?.hash ?? "");
  const eventId = String(upload.body?.eventId ?? "");
  assert(/^[a-f0-9]{64}$/.test(hash), `invalid hash: ${hash}`);
  assert(/^[a-f0-9]{64}$/.test(eventId), `invalid eventId: ${eventId}`);
  assert(typeof upload.body?.downloadUrl === "string", "missing downloadUrl in upload response");

  const replay = await requestJson(API_BASE, "/blobs", {
    method: "POST",
    headers: {
      "Idempotency-Key": idempotencyKey,
    },
  });
  assert(replay.status === 201, `idempotency replay failed: ${replay.status} ${replay.text}`);
  assert(replay.body?.hash === hash, "idempotency replay returned a different hash");
  assert(replay.body?.eventId === eventId, "idempotency replay returned a different eventId");

  const conflicting = new FormData();
  conflicting.append("file", new Blob(["conflicting-content"], { type: "text/plain" }), "conflict.txt");
  conflicting.append("folder", "/integration/e2e-conflict");
  const replayConflict = await requestJson(API_BASE, "/blobs", {
    method: "POST",
    headers: {
      "Idempotency-Key": idempotencyKey,
    },
    body: conflicting,
  });
  assertError(replayConflict, 409, "idempotency_key_conflict");

  const metadataResponse = await requestJson(API_BASE, `/blobs/${hash}`);
  assert(metadataResponse.status === 200, `metadata fetch failed: ${metadataResponse.status} ${metadataResponse.text}`);
  const metadata = metadataResponse.body?.metadata;
  assert(metadata, "missing metadata object");
  assert(metadata.hash === hash, "metadata hash mismatch");

  const download = await requestBinary(API_BASE, `/blobs/${hash}/download`);
  assert(download.status === 200, `download failed: ${download.status} ${download.text}`);
  assert(download.bytes && download.bytes.length > 0, "downloaded payload is empty");

  const downloadedSha = await sha256Hex(download.bytes);
  assert(downloadedSha === expectedPlainSha, `downloaded content sha mismatch: ${downloadedSha} != ${expectedPlainSha}`);

  const missing = await requestJson(API_BASE, `/blobs/${"0".repeat(64)}`);
  assertError(missing, 404, "metadata_not_found");

  const badHash = await requestJson(API_BASE, "/blobs/not-a-hash");
  assertError(badHash, 400, "invalid_hash");

  const softDelete = await requestJson(API_BASE, `/blobs/${hash}`, { method: "DELETE" });
  if (isKnownRelayFailure(softDelete)) {
    logSkip("e2e-flow", "external relay replaceable-upsert issue prevents delete acknowledgement");
  }

  assert(softDelete.status === 200, `delete failed: ${softDelete.status} ${softDelete.text}`);

  const afterDelete = await requestJson(API_BASE, `/blobs/${hash}`);
  assertError(afterDelete, 410, "metadata_deleted");

  const afterDeleteDownload = await requestBinary(API_BASE, `/blobs/${hash}/download`);
  assertError(afterDeleteDownload, 410, "blob_deleted");

  const secondDelete = await requestJson(API_BASE, `/blobs/${hash}`, { method: "DELETE" });
  assert(secondDelete.status === 200, `second delete should be idempotent: ${secondDelete.status} ${secondDelete.text}`);
  assert(secondDelete.body?.alreadyDeleted === true, "second delete response should include alreadyDeleted=true");

  console.log("[e2e-flow] PASS");
}

main().catch((error) => {
  console.error("[e2e-flow] FAIL", error instanceof Error ? error.message : String(error));
  runtimeProcess.exit(1);
});

export {};
