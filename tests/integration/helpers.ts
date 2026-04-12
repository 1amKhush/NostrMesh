export type HttpResult = {
  status: number;
  body: any;
  text: string;
  bytes?: Uint8Array;
};

const proc = (globalThis as { process?: { env: Record<string, string | undefined>; exit(code?: number): never } })
  .process;

if (!proc) {
  throw new Error("Node process global is required");
}

export const runtimeProcess: { env: Record<string, string | undefined>; exit(code?: number): never } = proc;

const RELAY_REJECTION_RE = /all promises were rejected/i;

export function apiBaseUrl(): string {
  return (runtimeProcess.env.NOSTRMESH_API_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertError(result: HttpResult, status: number, code: string): void {
  assert(result.status === status, `expected HTTP ${status}, got ${result.status}: ${result.text}`);
  assert(result.body?.code === code, `expected error code '${code}', got '${result.body?.code}'`);
}

export async function requestJson(base: string, path: string, init?: RequestInit): Promise<HttpResult> {
  const response = await fetch(`${base}${path}`, init);
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

export async function requestBinary(base: string, path: string, init?: RequestInit): Promise<HttpResult> {
  const response = await fetch(`${base}${path}`, init);
  const bytes = new Uint8Array(await response.arrayBuffer());

  let body: any = null;
  let text = "";

  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    text = new TextDecoder().decode(bytes);
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
    bytes,
  };
}

export function isKnownRelayFailure(result: HttpResult): boolean {
  return result.status >= 500 && typeof result.body?.error === "string" && RELAY_REJECTION_RE.test(result.body.error);
}

export function logSkip(scope: string, reason: string): never {
  console.log(`[${scope}] SKIP: ${reason}`);
  runtimeProcess.exit(0);
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(data).buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
