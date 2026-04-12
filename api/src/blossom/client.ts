import axios, { AxiosError } from "axios";
import { finalizeEvent, type EventTemplate } from "nostr-tools";
import { ApiError } from "../errors";

type BlossomVerb = "upload" | "get";

const MAX_BACKOFF_MS = 4000;

export interface BlossomRetryConfig {
  uploadAttempts: number;
  downloadAttempts: number;
  baseDelayMs: number;
}

export interface BlossomUploadResult {
  sha256: string;
  size: number;
  url: string;
}

export class BlossomClient {
  private readonly baseUrl: string;
  private readonly secretKeyHex: string;
  private readonly retryConfig: BlossomRetryConfig;

  constructor(baseUrl: string, secretKeyHex: string, retryConfig: BlossomRetryConfig) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.secretKeyHex = secretKeyHex;
    this.retryConfig = retryConfig;
  }

  private retryDelayMs(attempt: number): number {
    return Math.min(this.retryConfig.baseDelayMs * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
  }

  private async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async withRetry<T>(operation: string, attempts: number, execute: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await execute();
      } catch (error) {
        const normalized = normalizeBlossomError(error, operation);
        lastError = normalized;
        if (attempt >= attempts || !isRetryableBlossomError(normalized)) {
          throw normalized;
        }
        await this.wait(this.retryDelayMs(attempt));
      }
    }

    throw lastError ?? new ApiError(502, `blossom_${operation}_failed`, `Blossom ${operation} failed`);
  }

  buildAuthHeader(verb: BlossomVerb, content: string, expirationSeconds = 60): string {
    const secretKey = hexToBytes(this.secretKeyHex);
    const now = Math.floor(Date.now() / 1000);

    const template: EventTemplate = {
      kind: 24242,
      created_at: now,
      tags: [
        ["t", verb],
        ["expiration", String(now + expirationSeconds)],
      ],
      content,
    };

    const signed = finalizeEvent(template, secretKey);
    const encoded = Buffer.from(JSON.stringify(signed), "utf8").toString("base64");
    return `Nostr ${encoded}`;
  }

  async uploadBlob(payload: Buffer, filename: string): Promise<BlossomUploadResult> {
    const authHeader = this.buildAuthHeader("upload", `Upload ${filename}`);

    return this.withRetry("upload", this.retryConfig.uploadAttempts, async () => {
      const response = await axios.put(`${this.baseUrl}/upload`, payload, {
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/octet-stream",
        },
        validateStatus: () => true,
      });

      if (response.status < 200 || response.status >= 300) {
        const reason = response.headers["x-reason"] || response.statusText;
        throw new ApiError(
          mapBlossomStatus(response.status, 502),
          "blossom_upload_failed",
          `Blossom upload failed: ${reason}`
        );
      }

      const sha256 = response.data?.sha256 ?? response.data?.x;
      if (!sha256) {
        throw new Error("Blossom upload did not return sha256");
      }

      return {
        sha256,
        size: Number(response.data?.size ?? payload.length),
        url: response.data?.url ?? `${this.baseUrl}/${sha256}`,
      };
    });
  }

  async downloadBlob(sha256: string): Promise<Buffer> {
    const authHeader = this.buildAuthHeader("get", `Get ${sha256}`);

    return this.withRetry("download", this.retryConfig.downloadAttempts, async () => {
      const response = await axios.get<ArrayBuffer>(`${this.baseUrl}/${sha256}`, {
        headers: {
          Authorization: authHeader,
        },
        responseType: "arraybuffer",
        validateStatus: () => true,
      });

      if (response.status < 200 || response.status >= 300) {
        const reason = response.headers["x-reason"] || response.statusText;
        throw new ApiError(
          mapBlossomStatus(response.status, 502),
          "blossom_download_failed",
          `Blossom download failed: ${reason}`
        );
      }

      return Buffer.from(response.data);
    });
  }

  async checkBlob(sha256: string): Promise<boolean> {
    const authHeader = this.buildAuthHeader("get", `Head ${sha256}`);

    return this.withRetry("head", this.retryConfig.downloadAttempts, async () => {
      const response = await axios.head(`${this.baseUrl}/${sha256}`, {
        headers: {
          Authorization: authHeader,
        },
        validateStatus: () => true,
      });
      return response.status >= 200 && response.status < 300;
    });
  }
}

function hexToBytes(value: string): Uint8Array {
  if (value.length % 2 !== 0) {
    throw new Error("Hex string length must be even");
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) {
    const byte = Number.parseInt(value.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error("Invalid hex string");
    }
    bytes[i / 2] = byte;
  }
  return bytes;
}

function normalizeBlossomError(error: unknown, operation: string): Error {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof AxiosError) {
    if (!error.response) {
      return new ApiError(
        502,
        `blossom_${operation}_network_error`,
        `Blossom ${operation} failed: network or CORS issue`
      );
    }

    const reason =
      (typeof error.response.data === "object" && error.response.data && "error" in error.response.data
        ? String((error.response.data as { error: unknown }).error)
        : undefined) ||
      String(error.response.headers["x-reason"] || error.response.statusText);

    return new ApiError(
      mapBlossomStatus(error.response.status, 502),
      `blossom_${operation}_failed`,
      `Blossom ${operation} failed: ${reason}`
    );
  }

  if (error instanceof Error) {
    return new ApiError(502, `blossom_${operation}_failed`, error.message);
  }

  return new ApiError(502, `blossom_${operation}_failed`, `Blossom ${operation} failed`);
}

function isRetryableBlossomError(error: Error): boolean {
  if (error instanceof ApiError) {
    if (error.status === 408 || error.status === 429) {
      return true;
    }
    return error.status >= 500;
  }

  return true;
}

function mapBlossomStatus(status: number, fallback: number): number {
  if (status >= 400 && status < 500) {
    return status;
  }
  if (status >= 500 && status < 600) {
    return 502;
  }
  return fallback;
}
