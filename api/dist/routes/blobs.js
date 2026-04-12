"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.blobsRouter = void 0;
const crypto_1 = require("crypto");
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const config_1 = require("../config");
const errors_1 = require("../errors");
const client_1 = require("../blossom/client");
const crypto_2 = require("../crypto");
const schema_1 = require("../metadata/schema");
const client_2 = require("../nostr/client");
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
const blossomClient = new client_1.BlossomClient(config_1.config.blossomUrl, config_1.config.nostrSecretKey, {
    uploadAttempts: config_1.config.blossomUploadAttempts,
    downloadAttempts: config_1.config.blossomDownloadAttempts,
    baseDelayMs: config_1.config.blossomRetryBaseDelayMs,
});
const uploadIdempotencyCache = new Map();
exports.blobsRouter = (0, express_1.Router)();
function relayPublishRetryOptions() {
    return {
        attempts: config_1.config.relayPublishAttempts,
        baseDelayMs: config_1.config.relayRetryBaseDelayMs,
    };
}
function relayQueryRetryOptions() {
    return {
        attempts: config_1.config.relayQueryAttempts,
        baseDelayMs: config_1.config.relayRetryBaseDelayMs,
    };
}
function pruneIdempotencyCache(now) {
    for (const [key, value] of uploadIdempotencyCache.entries()) {
        if (value.expiresAt <= now) {
            uploadIdempotencyCache.delete(key);
        }
    }
}
function enforceIdempotencyCapacity(maxEntries) {
    while (uploadIdempotencyCache.size > maxEntries) {
        const oldest = uploadIdempotencyCache.keys().next().value;
        if (!oldest) {
            return;
        }
        uploadIdempotencyCache.delete(oldest);
    }
}
function uploadFingerprint(file, folder) {
    return (0, crypto_1.createHash)("sha256")
        .update(file.originalname)
        .update("\n")
        .update(file.mimetype || "application/octet-stream")
        .update("\n")
        .update(folder)
        .update("\n")
        .update(file.buffer)
        .digest("hex");
}
function parseIdempotencyKey(input) {
    if (!input) {
        return undefined;
    }
    const value = input.trim();
    if (!value) {
        return undefined;
    }
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
        throw new errors_1.ApiError(400, "invalid_idempotency_key", "Idempotency-Key must match [A-Za-z0-9._:-] and be at most 128 chars");
    }
    return value;
}
function normalizeHash(hash) {
    const normalized = hash.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        throw new errors_1.ApiError(400, "invalid_hash", "Invalid hash format");
    }
    return normalized;
}
function normalizeFolder(input) {
    if (input === undefined || input === null) {
        return "/";
    }
    if (typeof input !== "string") {
        throw new errors_1.ApiError(400, "invalid_folder", "Folder must be a string path");
    }
    const folder = input.trim();
    if (!folder) {
        return "/";
    }
    if (!folder.startsWith("/")) {
        throw new errors_1.ApiError(400, "invalid_folder", "Folder must start with '/'");
    }
    return folder;
}
async function resolveMetadata(hash) {
    let events;
    try {
        events = await (0, client_2.fetchEvents)((0, schema_1.metadataFilterByHash)(hash), config_1.config.relayUrls, relayQueryRetryOptions());
    }
    catch (error) {
        throw new errors_1.ApiError(502, (0, errors_1.relayErrorCode)(error, "query"), (0, errors_1.relayErrorMessage)(error, "query"));
    }
    if (events.length === 0) {
        return null;
    }
    try {
        return (0, schema_1.parseMetadataEvent)(events[0], config_1.config.nostrSecretKey);
    }
    catch (error) {
        throw new errors_1.ApiError(422, "invalid_metadata_event", `Stored metadata event is invalid: ${(0, errors_1.errorMessage)(error)}`);
    }
}
exports.blobsRouter.post("/", upload.single("file"), async (req, res, next) => {
    try {
        const now = Date.now();
        pruneIdempotencyCache(now);
        const idempotencyKey = parseIdempotencyKey(req.header("Idempotency-Key") ?? undefined);
        let folder;
        let fingerprint;
        if (req.file) {
            folder = normalizeFolder(req.body.folder);
            fingerprint = uploadFingerprint(req.file, folder);
        }
        if (idempotencyKey) {
            const cached = uploadIdempotencyCache.get(idempotencyKey);
            if (cached && cached.expiresAt > now) {
                if (fingerprint && cached.fingerprint !== fingerprint) {
                    throw new errors_1.ApiError(409, "idempotency_key_conflict", "Idempotency-Key replay payload does not match the original request");
                }
                res.status(cached.status).json(cached.body);
                return;
            }
        }
        if (!req.file) {
            throw new errors_1.ApiError(400, "missing_file", "Missing file upload field 'file'");
        }
        const resolvedFolder = folder ?? normalizeFolder(req.body.folder);
        const resolvedFingerprint = fingerprint ?? uploadFingerprint(req.file, resolvedFolder);
        const encrypted = (0, crypto_2.encryptBlob)(req.file.buffer);
        const uploaded = await blossomClient.uploadBlob(encrypted.ciphertext, req.file.originalname);
        const metadata = {
            name: req.file.originalname,
            hash: uploaded.sha256,
            size: req.file.size,
            type: req.file.mimetype || "application/octet-stream",
            folder: resolvedFolder,
            uploadedAt: Math.floor(Date.now() / 1000),
            server: config_1.config.blossomPublicUrl,
            encryptionKey: encrypted.encryptionKey,
        };
        const metadataEvent = (0, schema_1.buildMetadataEvent)(metadata, config_1.config.nostrSecretKey);
        try {
            await (0, client_2.publishEvent)(metadataEvent, config_1.config.relayUrls, relayPublishRetryOptions());
        }
        catch (error) {
            throw new errors_1.ApiError(502, (0, errors_1.relayErrorCode)(error, "publish"), (0, errors_1.relayErrorMessage)(error, "publish"));
        }
        const responseBody = {
            eventId: metadataEvent.id,
            hash: metadata.hash,
            downloadUrl: `/blobs/${metadata.hash}/download`,
            metadata,
        };
        if (idempotencyKey) {
            uploadIdempotencyCache.set(idempotencyKey, {
                status: 201,
                body: responseBody,
                expiresAt: now + config_1.config.idempotencyTtlSeconds * 1000,
                fingerprint: resolvedFingerprint,
            });
            enforceIdempotencyCapacity(config_1.config.idempotencyMaxEntries);
        }
        res.status(201).json(responseBody);
    }
    catch (error) {
        next(error);
    }
});
exports.blobsRouter.get("/:hash", async (req, res, next) => {
    try {
        const hash = normalizeHash(req.params.hash);
        const metadata = await resolveMetadata(hash);
        if (!metadata) {
            throw new errors_1.ApiError(404, "metadata_not_found", "Metadata not found");
        }
        if (metadata.deleted) {
            throw new errors_1.ApiError(410, "metadata_deleted", "Blob metadata is marked deleted");
        }
        res.json({
            metadata,
            downloadUrl: `/blobs/${hash}/download`,
        });
    }
    catch (error) {
        next(error);
    }
});
exports.blobsRouter.get("/:hash/download", async (req, res, next) => {
    try {
        const hash = normalizeHash(req.params.hash);
        const metadata = await resolveMetadata(hash);
        if (!metadata) {
            throw new errors_1.ApiError(404, "blob_not_found", "Blob not found");
        }
        if (metadata.deleted) {
            throw new errors_1.ApiError(410, "blob_deleted", "Blob metadata is marked deleted");
        }
        const encryptedPayload = await blossomClient.downloadBlob(hash);
        const decrypted = (0, crypto_2.decryptBlob)(encryptedPayload, metadata.encryptionKey);
        res.setHeader("Content-Type", metadata.type || "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename=\"${metadata.name}\"`);
        res.send(decrypted);
    }
    catch (error) {
        next(error);
    }
});
exports.blobsRouter.delete("/:hash", async (req, res, next) => {
    try {
        const hash = normalizeHash(req.params.hash);
        const metadata = await resolveMetadata(hash);
        if (!metadata) {
            throw new errors_1.ApiError(404, "metadata_not_found", "Metadata not found");
        }
        if (metadata.deleted) {
            res.json({
                hash,
                deleted: true,
                alreadyDeleted: true,
            });
            return;
        }
        const deleteEvent = (0, schema_1.buildSoftDeleteEvent)(metadata, config_1.config.nostrSecretKey);
        try {
            await (0, client_2.publishEvent)(deleteEvent, config_1.config.relayUrls, relayPublishRetryOptions());
        }
        catch (error) {
            throw new errors_1.ApiError(502, (0, errors_1.relayErrorCode)(error, "publish"), (0, errors_1.relayErrorMessage)(error, "publish"));
        }
        res.json({
            hash,
            deleted: true,
            eventId: deleteEvent.id,
        });
    }
    catch (error) {
        next(error);
    }
});
