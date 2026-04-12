/* eslint-disable no-console */

import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { once } from "events";
import path from "path";

type HttpResult = {
  status: number;
  body: any;
  text: string;
};

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const API_DIR = path.resolve(ROOT_DIR, "api");
const DEFAULT_ISOLATED_PORT = String(4100 + Math.floor(Math.random() * 400));
const ISOLATED_API_PORT = Number.parseInt(process.env.NOSTRMESH_RELAY_FAILURE_API_PORT ?? DEFAULT_ISOLATED_PORT, 10);
const ISOLATED_API_BASE = `http://127.0.0.1:${ISOLATED_API_PORT}`;
const EMPTY_RELAY_URLS = ",";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertRelay502(result: HttpResult, action: "publish" | "query"): void {
  assert(result.status === 502, `expected 502 for relay ${action}, got ${result.status}: ${result.text}`);
  const code = String(result.body?.code ?? "");
  assert(code.startsWith(`relay_${action}_`), `expected relay_${action}_* code, got '${code}'`);
}

async function requestJson(url: string, init?: RequestInit): Promise<HttpResult> {
  const response = await fetch(url, init);
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

async function waitForApiHealthy(timeoutMs = 20000): Promise<HttpResult> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await requestJson(`${ISOLATED_API_BASE}/health`);
      if (health.status === 200) {
        return health;
      }
    } catch {
      // Keep polling until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`isolated API did not become healthy within ${timeoutMs}ms`);
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");

  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);

  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function startIsolatedApi(): Promise<ChildProcessWithoutNullStreams> {
  const tsxPath = path.resolve(API_DIR, "node_modules", ".bin", "tsx");
  const blossomUrl = process.env.BLOSSOM_HTTP_URL ?? "http://127.0.0.1:3000";

  const env = {
    ...process.env,
    API_PORT: String(ISOLATED_API_PORT),
    RELAY_URLS: EMPTY_RELAY_URLS,
    RELAY_PUBLISH_ATTEMPTS: "1",
    RELAY_QUERY_ATTEMPTS: "1",
    RELAY_RETRY_BASE_DELAY_MS: "50",
    BLOSSOM_URL: blossomUrl,
    BLOSSOM_PUBLIC_URL: blossomUrl,
  };

  const child = spawn(tsxPath, ["src/index.ts"], {
    cwd: API_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", () => {
    // Intentionally no-op; keeping stream consumed prevents buffer backpressure.
  });

  child.stderr.on("data", () => {
    // Intentionally no-op; keeping stream consumed prevents buffer backpressure.
  });

  const health = await waitForApiHealthy();
  const relayUrls = Array.isArray(health.body?.relayUrls) ? health.body.relayUrls : [];
  assert(
    relayUrls.length === 0,
    `isolated API should have no configured relays for this test; relayUrls=${JSON.stringify(relayUrls)}`
  );

  return child;
}

async function main(): Promise<void> {
  const blossomHealth = await requestJson(`${process.env.BLOSSOM_HTTP_URL ?? "http://127.0.0.1:3000"}/health`);
  assert(blossomHealth.status === 200, `blossom health check failed: ${blossomHealth.status}`);

  const isolatedApi = await startIsolatedApi();

  try {
    const hash = "b".repeat(64);
    const blobMetadata = await requestJson(`${ISOLATED_API_BASE}/blobs/${hash}`);
    assertRelay502(blobMetadata, "query");

    const eventId = "a".repeat(64);
    const eventQuery = await requestJson(`${ISOLATED_API_BASE}/events/${eventId}`);
    assertRelay502(eventQuery, "query");

    const hashQuery = await requestJson(`${ISOLATED_API_BASE}/events?hash=${hash}`);
    assertRelay502(hashQuery, "query");

    console.log("[relay-failure-contract] PASS");
  } finally {
    await stopProcess(isolatedApi);
  }
}

main().catch((error) => {
  console.error("[relay-failure-contract] FAIL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
