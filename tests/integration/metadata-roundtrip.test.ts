/* eslint-disable no-console */

type HttpResult = {
  status: number;
  body: any;
  text: string;
};

const API_BASE = (process.env.NOSTRMESH_API_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const RELAY_REJECTION_RE = /all promises were rejected/i;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(path: string, init?: RequestInit): Promise<HttpResult> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const text = await response.text();

  let body: any = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  return {
    status: response.status,
    body,
    text,
  };
}

function isKnownRelayFailure(result: HttpResult): boolean {
  return result.status >= 500 && typeof result.body?.error === "string" && RELAY_REJECTION_RE.test(result.body.error);
}

function logSkip(reason: string): never {
  console.log(`[metadata-roundtrip] SKIP: ${reason}`);
  process.exit(0);
}

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
  const health = await requestJson("/health");
  assert(health.status === 200, `health check failed: ${health.status} ${health.text}`);

  const upload = await requestJson("/blobs", {
    method: "POST",
    body: buildUploadPayload("upload"),
  });

  if (isKnownRelayFailure(upload)) {
    logSkip("external relay publish issue (All promises were rejected)");
  }

  assert(upload.status === 201, `upload failed: ${upload.status} ${upload.text}`);
  const eventId = String(upload.body?.eventId ?? "");
  const hash = String(upload.body?.hash ?? "");
  const uploadMetadata = upload.body?.metadata;

  assert(eventId.length > 0, "upload response missing eventId");
  assert(/^[a-f0-9]{64}$/.test(hash), `upload response hash invalid: ${hash}`);
  assert(uploadMetadata, "upload response missing metadata");
  expectMeshServer(String(uploadMetadata.server ?? ""));

  const metadataResponse = await requestJson(`/blobs/${hash}`);
  assert(metadataResponse.status === 200, `metadata fetch failed: ${metadataResponse.status} ${metadataResponse.text}`);
  const metadata = metadataResponse.body?.metadata;
  assert(metadata, "metadata payload missing metadata object");
  assert(metadata.hash === hash, `metadata hash mismatch: expected ${hash}, got ${metadata.hash}`);
  expectMeshServer(String(metadata.server ?? ""));

  const eventResponse = await requestJson(`/events/${eventId}`);
  if (isKnownRelayFailure(eventResponse)) {
    console.log("[metadata-roundtrip] WARN: relay event fetch hit known external issue");
  } else {
    assert(eventResponse.status === 200, `event fetch failed: ${eventResponse.status} ${eventResponse.text}`);
    const event = eventResponse.body?.event;
    assert(event, "event fetch payload missing event");
    assert(event.id === eventId, `event id mismatch: expected ${eventId}, got ${event.id}`);
  }

  const hashQueryResponse = await requestJson(`/events?hash=${hash}`);
  if (isKnownRelayFailure(hashQueryResponse)) {
    console.log("[metadata-roundtrip] WARN: relay hash query hit known external issue");
  } else {
    assert(
      hashQueryResponse.status === 200,
      `hash query failed: ${hashQueryResponse.status} ${hashQueryResponse.text}`
    );
    assert(Array.isArray(hashQueryResponse.body?.events), "hash query response missing events array");
  }

  const softDelete = await requestJson(`/blobs/${hash}`, { method: "DELETE" });
  if (isKnownRelayFailure(softDelete)) {
    logSkip("external relay replaceable-upsert issue prevents soft delete acknowledgement");
  }

  assert(softDelete.status === 200, `soft delete failed: ${softDelete.status} ${softDelete.text}`);
  assert(softDelete.body?.deleted === true, "soft delete response missing deleted=true");

  const afterDelete = await requestJson(`/blobs/${hash}`);
  assert(afterDelete.status === 410, `expected 410 after soft delete, got ${afterDelete.status} ${afterDelete.text}`);

  console.log("[metadata-roundtrip] PASS");
}

main().catch((error) => {
  console.error("[metadata-roundtrip] FAIL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
