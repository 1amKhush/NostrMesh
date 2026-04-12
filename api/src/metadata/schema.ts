import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { finalizeEvent, type Event, type EventTemplate } from "nostr-tools";

const METADATA_KIND = 34578;
const METADATA_ENCRYPTION_VERSION = 1;

export interface BlobMetadata {
  name: string;
  hash: string;
  size: number;
  type: string;
  folder: string;
  uploadedAt: number;
  server: string;
  encryptionKey: string;
  deleted?: boolean;
}

export function validateMetadata(metadata: BlobMetadata): void {
  if (!metadata.name.trim()) {
    throw new Error("Metadata name is required");
  }
  if (!/^[a-f0-9]{64}$/i.test(metadata.hash)) {
    throw new Error("Metadata hash must be a 64-char hex SHA-256");
  }
  if (!Number.isInteger(metadata.size) || metadata.size < 0) {
    throw new Error("Metadata size must be a non-negative integer");
  }
  if (!metadata.folder.startsWith("/")) {
    throw new Error("Metadata folder must start with '/'");
  }
  if (!/^https?:\/\//i.test(metadata.server)) {
    throw new Error("Metadata server must be an http(s) URL");
  }
  if (!/^[a-f0-9]{64}$/i.test(metadata.encryptionKey)) {
    throw new Error("Metadata encryptionKey must be 64-char hex");
  }
}

function metadataKeyFromSecret(secretKeyHex: string): Buffer {
  return createHash("sha256").update(`nostrmesh:metadata:${secretKeyHex}`).digest();
}

function encryptMetadata(metadata: BlobMetadata, secretKeyHex: string): string {
  const key = metadataKeyFromSecret(secretKeyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(metadata), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([Buffer.from([METADATA_ENCRYPTION_VERSION]), iv, authTag, encrypted]);
  return payload.toString("base64");
}

function decryptMetadata(content: string, secretKeyHex: string): BlobMetadata {
  const payload = Buffer.from(content, "base64");
  if (payload.length < 29) {
    throw new Error("Metadata payload is too small");
  }

  const version = payload.readUInt8(0);
  if (version !== METADATA_ENCRYPTION_VERSION) {
    throw new Error(`Unsupported metadata encryption version: ${version}`);
  }

  const iv = payload.subarray(1, 13);
  const authTag = payload.subarray(13, 29);
  const encrypted = payload.subarray(29);

  const key = metadataKeyFromSecret(secretKeyHex);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  const metadata = JSON.parse(plaintext) as BlobMetadata;
  validateMetadata(metadata);
  return metadata;
}

export function buildMetadataEvent(metadata: BlobMetadata, secretKeyHex: string): Event {
  validateMetadata(metadata);

  const secretKey = hexToBytes(secretKeyHex);

  const template: EventTemplate = {
    kind: METADATA_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["d", metadata.hash],
      ["client", "nostrmesh"],
      ["encrypted", "aead-v1"],
    ],
    content: encryptMetadata(metadata, secretKeyHex),
  };

  return finalizeEvent(template, secretKey);
}

export function parseMetadataEvent(event: Event, secretKeyHex: string): BlobMetadata {
  if (event.kind !== METADATA_KIND) {
    throw new Error(`Unexpected event kind: ${event.kind}`);
  }
  return decryptMetadata(event.content, secretKeyHex);
}

export function buildSoftDeleteEvent(existing: BlobMetadata, secretKeyHex: string): Event {
  const deletedMetadata: BlobMetadata = {
    ...existing,
    deleted: true,
    uploadedAt: Math.floor(Date.now() / 1000),
  };
  return buildMetadataEvent(deletedMetadata, secretKeyHex);
}

export function metadataFilterByHash(hash: string): { kinds: number[]; "#d": string[]; limit: number } {
  return {
    kinds: [METADATA_KIND],
    "#d": [hash],
    limit: 50,
  };
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
