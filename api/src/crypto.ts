import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const PAYLOAD_VERSION = 1;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export interface EncryptedBlob {
  ciphertext: Buffer;
  encryptionKey: string;
}

export function encryptBlob(data: Buffer, existingKeyHex?: string): EncryptedBlob {
  const key = existingKeyHex ? Buffer.from(existingKeyHex, "hex") : randomBytes(KEY_LENGTH);
  if (key.length !== KEY_LENGTH) {
    throw new Error("Encryption key must be 32 bytes (64 hex chars)");
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const payload = Buffer.concat([
    Buffer.from([PAYLOAD_VERSION]),
    iv,
    authTag,
    encrypted,
  ]);

  return {
    ciphertext: payload,
    encryptionKey: key.toString("hex"),
  };
}

export function decryptBlob(payload: Buffer, encryptionKeyHex: string): Buffer {
  const key = Buffer.from(encryptionKeyHex, "hex");
  if (key.length !== KEY_LENGTH) {
    throw new Error("Invalid encryption key size");
  }

  if (payload.length < 1 + IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Ciphertext payload is too small");
  }

  const version = payload.readUInt8(0);
  if (version !== PAYLOAD_VERSION) {
    throw new Error(`Unsupported payload version: ${version}`);
  }

  const ivStart = 1;
  const ivEnd = ivStart + IV_LENGTH;
  const tagEnd = ivEnd + AUTH_TAG_LENGTH;

  const iv = payload.subarray(ivStart, ivEnd);
  const authTag = payload.subarray(ivEnd, tagEnd);
  const encrypted = payload.subarray(tagEnd);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
