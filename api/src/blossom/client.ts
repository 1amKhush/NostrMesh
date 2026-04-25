import axios, { AxiosError } from "axios";
import { finalizeEvent, type EventTemplate } from "nostr-tools";

type BlossomVerb = "upload" | "get";

export interface BlossomUploadResult {
  sha256: string;
  size: number;
  url: string;
}

export class BlossomClient {
  private readonly baseUrl: string;
  private readonly secretKeyHex: string;

  constructor(baseUrl: string, secretKeyHex: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.secretKeyHex = secretKeyHex;
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

    try {
      const response = await axios.put(`${this.baseUrl}/upload`, payload, {
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/octet-stream",
        },
        validateStatus: () => true,
      });

      if (response.status < 200 || response.status >= 300) {
        const reason = response.headers["x-reason"] || response.statusText;
        throw new Error(`Blossom upload failed: ${reason}`);
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
    } catch (error) {
      throw normalizeBlossomError(error, "upload");
    }
  }

  async downloadBlob(sha256: string): Promise<Buffer> {
    const authHeader = this.buildAuthHeader("get", `Get ${sha256}`);
    try {
      const response = await axios.get<ArrayBuffer>(`${this.baseUrl}/${sha256}`, {
        headers: {
          Authorization: authHeader,
        },
        responseType: "arraybuffer",
        validateStatus: () => true,
      });

      if (response.status < 200 || response.status >= 300) {
        const reason = response.headers["x-reason"] || response.statusText;
        throw new Error(`Blossom download failed: ${reason}`);
      }

      return Buffer.from(response.data);
    } catch (error) {
      throw normalizeBlossomError(error, "download");
    }
  }

  async checkBlob(sha256: string): Promise<boolean> {
    const authHeader = this.buildAuthHeader("get", `Head ${sha256}`);
    try {
      const response = await axios.head(`${this.baseUrl}/${sha256}`, {
        headers: {
          Authorization: authHeader,
        },
        validateStatus: () => true,
      });
      return response.status >= 200 && response.status < 300;
    } catch (error) {
      throw normalizeBlossomError(error, "head");
    }
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
  if (error instanceof AxiosError) {
    if (!error.response) {
      return new Error(`Blossom ${operation} failed: network or CORS issue`);
    }

    const reason =
      (typeof error.response.data === "object" && error.response.data && "error" in error.response.data
        ? String((error.response.data as { error: unknown }).error)
        : undefined) ||
      String(error.response.headers["x-reason"] || error.response.statusText);

    return new Error(`Blossom ${operation} failed: ${reason}`);
  }

  return error instanceof Error ? error : new Error(`Blossom ${operation} failed`);
}
