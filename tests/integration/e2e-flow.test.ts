/* eslint-disable no-console */

import { createHash } from "crypto";

type HttpResult = {
  status: number;
  body: any;
  text: string;
  bytes?: Uint8Array;
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

async function requestBinary(path: string, init?: RequestInit): Promise<HttpResult> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const buffer = new Uint8Array(await response.arrayBuffer());

  let text = "";
  let body: any = null;

  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    text = new TextDecoder().decode(buffer);
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
    bytes: buffer,
  };
}

function isKnownRelayFailure(result: HttpResult): boolean {
  return result.status >= 500 && typeof result.body?.error === "string" && RELAY_REJECTION_RE.test(result.body.error);
}

function logSkip(reason: string): never {
  console.log(`[e2e-flow] SKIP: ${reason}`);
  process.exit(0);
}

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

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
  const health = await requestJson("/health");
  assert(health.status === 200, `health check failed: ${health.status} ${health.text}`);

  const { form, plainBytes } = buildPayload();
  const expectedPlainSha = sha256Hex(plainBytes);

  const upload = await requestJson("/blobs", {
    method: "POST",
    body: form,
  });

  if (isKnownRelayFailure(upload)) {
    logSkip("external relay publish issue (All promises were rejected)");
  }

  assert(upload.status === 201, `upload failed: ${upload.status} ${upload.text}`);

  const hash = String(upload.body?.hash ?? "");
  assert(/^[a-f0-9]{64}$/.test(hash), `invalid hash: ${hash}`);
  assert(typeof upload.body?.downloadUrl === "string", "missing downloadUrl in upload response");

  const metadataResponse = await requestJson(`/blobs/${hash}`);
  assert(metadataResponse.status === 200, `metadata fetch failed: ${metadataResponse.status} ${metadataResponse.text}`);
  const metadata = metadataResponse.body?.metadata;
  assert(metadata, "missing metadata object");
  assert(metadata.hash === hash, "metadata hash mismatch");

  const download = await requestBinary(`/blobs/${hash}/download`);
  assert(download.status === 200, `download failed: ${download.status} ${download.text}`);
  assert(download.bytes && download.bytes.length > 0, "downloaded payload is empty");

  const downloadedSha = sha256Hex(download.bytes);
  assert(downloadedSha === expectedPlainSha, `downloaded content sha mismatch: ${downloadedSha} != ${expectedPlainSha}`);

  const missing = await requestJson(`/blobs/${"0".repeat(64)}`);
  assert(missing.status === 404, `expected 404 for non-existent hash, got ${missing.status}`);

  const badHash = await requestJson("/blobs/not-a-hash");
  assert(badHash.status === 400, `expected 400 for invalid hash format, got ${badHash.status}`);

  const softDelete = await requestJson(`/blobs/${hash}`, { method: "DELETE" });
  if (isKnownRelayFailure(softDelete)) {
    logSkip("external relay replaceable-upsert issue prevents delete acknowledgement");
  }

  assert(softDelete.status === 200, `delete failed: ${softDelete.status} ${softDelete.text}`);

  const afterDelete = await requestJson(`/blobs/${hash}`);
  assert(afterDelete.status === 410, `expected 410 after delete, got ${afterDelete.status}`);

  const afterDeleteDownload = await requestBinary(`/blobs/${hash}/download`);
  assert(afterDeleteDownload.status === 410, `expected 410 download after delete, got ${afterDeleteDownload.status}`);

  console.log("[e2e-flow] PASS");
}

main().catch((error) => {
  console.error("[e2e-flow] FAIL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
