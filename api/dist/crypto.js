"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptBlob = encryptBlob;
exports.decryptBlob = decryptBlob;
const crypto_1 = require("crypto");
const PAYLOAD_VERSION = 1;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
function encryptBlob(data, existingKeyHex) {
    const key = existingKeyHex ? Buffer.from(existingKeyHex, "hex") : (0, crypto_1.randomBytes)(KEY_LENGTH);
    if (key.length !== KEY_LENGTH) {
        throw new Error("Encryption key must be 32 bytes (64 hex chars)");
    }
    const iv = (0, crypto_1.randomBytes)(IV_LENGTH);
    const cipher = (0, crypto_1.createCipheriv)("aes-256-gcm", key, iv);
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
function decryptBlob(payload, encryptionKeyHex) {
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
    const decipher = (0, crypto_1.createDecipheriv)("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
