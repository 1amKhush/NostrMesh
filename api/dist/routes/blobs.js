"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.blobsRouter = void 0;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const config_1 = require("../config");
const errors_1 = require("../errors");
const client_1 = require("../blossom/client");
const crypto_1 = require("../crypto");
const schema_1 = require("../metadata/schema");
const client_2 = require("../nostr/client");
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
const blossomClient = new client_1.BlossomClient(config_1.config.blossomUrl, config_1.config.nostrSecretKey);
exports.blobsRouter = (0, express_1.Router)();
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
        events = await (0, client_2.fetchEvents)((0, schema_1.metadataFilterByHash)(hash), config_1.config.relayUrls);
    }
    catch (error) {
        throw new errors_1.ApiError(502, (0, errors_1.relayErrorCode)(error, "query"), (0, errors_1.relayErrorMessage)(error, "query"));
    }
    if (events.length === 0) {
        return null;
    }
    return (0, schema_1.parseMetadataEvent)(events[0], config_1.config.nostrSecretKey);
}
exports.blobsRouter.post("/", upload.single("file"), async (req, res, next) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: "Missing file upload field 'file'" });
            return;
        }
        const folder = normalizeFolder(req.body.folder);
        const encrypted = (0, crypto_1.encryptBlob)(req.file.buffer);
        const uploaded = await blossomClient.uploadBlob(encrypted.ciphertext, req.file.originalname);
        const metadata = {
            name: req.file.originalname,
            hash: uploaded.sha256,
            size: req.file.size,
            type: req.file.mimetype || "application/octet-stream",
            folder,
            uploadedAt: Math.floor(Date.now() / 1000),
            server: config_1.config.blossomPublicUrl,
            encryptionKey: encrypted.encryptionKey,
        };
        const metadataEvent = (0, schema_1.buildMetadataEvent)(metadata, config_1.config.nostrSecretKey);
        try {
            await (0, client_2.publishEvent)(metadataEvent, config_1.config.relayUrls);
        }
        catch (error) {
            throw new errors_1.ApiError(502, (0, errors_1.relayErrorCode)(error, "publish"), (0, errors_1.relayErrorMessage)(error, "publish"));
        }
        res.status(201).json({
            eventId: metadataEvent.id,
            hash: metadata.hash,
            downloadUrl: `/blobs/${metadata.hash}/download`,
            metadata,
        });
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
            res.status(404).json({ error: "Metadata not found" });
            return;
        }
        if (metadata.deleted) {
            res.status(410).json({ error: "Blob metadata is marked deleted" });
            return;
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
        if (!metadata || metadata.deleted) {
            res.status(metadata?.deleted ? 410 : 404).json({
                error: metadata?.deleted ? "Blob metadata is marked deleted" : "Blob not found",
            });
            return;
        }
        const encryptedPayload = await blossomClient.downloadBlob(hash);
        const decrypted = (0, crypto_1.decryptBlob)(encryptedPayload, metadata.encryptionKey);
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
            res.status(404).json({ error: "Metadata not found" });
            return;
        }
        const deleteEvent = (0, schema_1.buildSoftDeleteEvent)(metadata, config_1.config.nostrSecretKey);
        try {
            await (0, client_2.publishEvent)(deleteEvent, config_1.config.relayUrls);
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
