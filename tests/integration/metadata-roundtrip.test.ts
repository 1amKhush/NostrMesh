/* eslint-disable no-console */

import {
  apiBaseUrl,
  assert,
  assertError,
  isKnownRelayFailure,
  logSkip,
  requestJson,
  runtimeProcess,
} from "./helpers";

const API_BASE = apiBaseUrl();

function expectMeshServer(server: string): void {
  assert(/^https?:\/\//i.test(server), `metadata.server must be http(s), got: ${server}`);
  assert(!/localhost|127\.0\.0\.1/i.test(server), `metadata.server should be mesh/public, got local URL: ${server}`);
}

function buildUploadPayload(label: string): FormData {
  const content = `nostrmesh-metadata-roundtrip-${label}-${Date.now()}`;
  const blob = new Blob([content], { type: "text/plain" });
  const form = new FormData();
  form.append("file", blob, `metadata-roundtrip-${label}.txt`);
  form.append("folder", "/integration/metadata-roundtrip");
  return form;
}

async function main(): Promise<void> {
  const health = await requestJson(API_BASE, "/health");
  assert(health.status === 200, `health check failed: ${health.status} ${health.text}`);

  const upload = await requestJson(API_BASE, "/blobs", {
    method: "POST",
    body: buildUploadPayload("upload"),
  });

  if (isKnownRelayFailure(upload)) {
    logSkip("metadata-roundtrip", "external relay publish issue (All promises were rejected)");
  }

  assert(upload.status === 201, `upload failed: ${upload.status} ${upload.text}`);
  const eventId = String(upload.body?.eventId ?? "");
  const hash = String(upload.body?.hash ?? "");
  const uploadMetadata = upload.body?.metadata;

  assert(eventId.length > 0, "upload response missing eventId");
  assert(/^[a-f0-9]{64}$/.test(hash), `upload response hash invalid: ${hash}`);
  assert(uploadMetadata, "upload response missing metadata");
  expectMeshServer(String(uploadMetadata.server ?? ""));

  const metadataResponse = await requestJson(API_BASE, `/blobs/${hash}`);
  assert(metadataResponse.status === 200, `metadata fetch failed: ${metadataResponse.status} ${metadataResponse.text}`);
  const metadata = metadataResponse.body?.metadata;
  assert(metadata, "metadata payload missing metadata object");
  assert(metadata.hash === hash, `metadata hash mismatch: expected ${hash}, got ${metadata.hash}`);
  expectMeshServer(String(metadata.server ?? ""));

  const eventResponse = await requestJson(API_BASE, `/events/${eventId}`);
  if (isKnownRelayFailure(eventResponse)) {
    console.log("[metadata-roundtrip] WARN: relay event fetch hit known external issue");
  } else {
    assert(eventResponse.status === 200, `event fetch failed: ${eventResponse.status} ${eventResponse.text}`);
    const event = eventResponse.body?.event;
    const eventMetadata = eventResponse.body?.metadata;
    assert(event, "event fetch payload missing event");
    assert(eventMetadata, "event fetch payload missing metadata");
    assert(event.id === eventId, `event id mismatch: expected ${eventId}, got ${event.id}`);
    assert(eventMetadata.hash === hash, `event metadata hash mismatch: expected ${hash}, got ${eventMetadata.hash}`);
  }

  const hashQueryResponse = await requestJson(API_BASE, `/events?hash=${hash}`);
  if (isKnownRelayFailure(hashQueryResponse)) {
    console.log("[metadata-roundtrip] WARN: relay hash query hit known external issue");
  } else {
    assert(
      hashQueryResponse.status === 200,
      `hash query failed: ${hashQueryResponse.status} ${hashQueryResponse.text}`
    );
    assert(Array.isArray(hashQueryResponse.body?.events), "hash query response missing events array");
    if (hashQueryResponse.body.events.length > 0) {
      assert(hashQueryResponse.body.events[0]?.event, "hash query row missing event");
      assert(hashQueryResponse.body.events[0]?.metadata, "hash query row missing metadata");
    }
  }

  const missingHashQuery = await requestJson(API_BASE, "/events");
  assertError(missingHashQuery, 400, "missing_hash");

  const invalidHashQuery = await requestJson(API_BASE, "/events?hash=bad");
  assertError(invalidHashQuery, 400, "invalid_hash");

  const softDelete = await requestJson(API_BASE, `/blobs/${hash}`, { method: "DELETE" });
  if (isKnownRelayFailure(softDelete)) {
    logSkip("metadata-roundtrip", "external relay replaceable-upsert issue prevents soft delete acknowledgement");
  }

  assert(softDelete.status === 200, `soft delete failed: ${softDelete.status} ${softDelete.text}`);
  assert(softDelete.body?.deleted === true, "soft delete response missing deleted=true");

  const afterDelete = await requestJson(API_BASE, `/blobs/${hash}`);
  assert(afterDelete.status === 410, `expected 410 after soft delete, got ${afterDelete.status} ${afterDelete.text}`);

  console.log("[metadata-roundtrip] PASS");
}

main().catch((error) => {
  console.error("[metadata-roundtrip] FAIL", error instanceof Error ? error.message : String(error));
  runtimeProcess.exit(1);
});

export {};
