"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const express_1 = __importDefault(require("express"));
const fs_1 = require("fs");
const js_yaml_1 = __importDefault(require("js-yaml"));
const path_1 = __importDefault(require("path"));
const nostr_tools_1 = require("nostr-tools");
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
const defaultConfig = {
    server: {
        host: "0.0.0.0",
        port: 3000,
        publicBaseUrl: "http://localhost:3000",
    },
    storage: {
        path: "/data/blossom",
    },
    limits: {
        maxUploadBytes: 100 * 1024 * 1024,
    },
    cors: {
        allowedOrigins: ["http://localhost:3000", "http://localhost:4000"],
    },
    auth: {
        requireAuth: true,
        maxClockSkewSeconds: 30,
    },
};
function loadConfig() {
    const configPath = process.env.BLOSSOM_CONFIG ?? path_1.default.resolve(process.cwd(), "config.yml");
    const envPublicBaseUrl = process.env.BLOSSOM_PUBLIC_URL?.replace(/\/$/, "");
    if (!(0, fs_1.existsSync)(configPath)) {
        return {
            ...defaultConfig,
            server: {
                ...defaultConfig.server,
                publicBaseUrl: envPublicBaseUrl ?? defaultConfig.server.publicBaseUrl,
            },
        };
    }
    const loaded = js_yaml_1.default.load((0, fs_1.readFileSync)(configPath, "utf8"));
    return {
        server: {
            host: loaded.server?.host ?? defaultConfig.server.host,
            port: loaded.server?.port ?? defaultConfig.server.port,
            publicBaseUrl: envPublicBaseUrl ?? loaded.server?.publicBaseUrl ?? defaultConfig.server.publicBaseUrl,
        },
        storage: {
            path: loaded.storage?.path ?? defaultConfig.storage.path,
        },
        limits: {
            maxUploadBytes: loaded.limits?.maxUploadBytes ?? defaultConfig.limits.maxUploadBytes,
        },
        cors: {
            allowedOrigins: loaded.cors?.allowedOrigins ?? defaultConfig.cors.allowedOrigins,
        },
        auth: {
            requireAuth: loaded.auth?.requireAuth ?? defaultConfig.auth.requireAuth,
            maxClockSkewSeconds: loaded.auth?.maxClockSkewSeconds ?? defaultConfig.auth.maxClockSkewSeconds,
        },
    };
}
const config = loadConfig();
const storagePath = path_1.default.resolve(config.storage.path);
(0, fs_1.mkdirSync)(storagePath, { recursive: true });
const app = (0, express_1.default)();
function isAllowedOrigin(origin) {
    if (!origin) {
        return true;
    }
    if (config.cors.allowedOrigins.includes("*")) {
        return true;
    }
    return config.cors.allowedOrigins.includes(origin);
}
function findTag(event, key) {
    const tag = event.tags.find((entry) => entry[0] === key);
    return tag?.[1];
}
function parseAuthEvent(headerValue, expectedVerb) {
    if (!config.auth.requireAuth) {
        return "anonymous";
    }
    if (!headerValue || !headerValue.startsWith("Nostr ")) {
        throw new HttpError(401, "Missing or invalid Authorization header");
    }
    const encoded = headerValue.slice("Nostr ".length).trim();
    let event;
    try {
        event = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    }
    catch {
        throw new HttpError(401, "Authorization payload is not valid base64 JSON");
    }
    if (event.kind !== 24242) {
        throw new HttpError(401, "Authorization event kind must be 24242");
    }
    if (!event.id || !event.sig || !event.pubkey) {
        throw new HttpError(401, "Authorization event missing id, sig, or pubkey");
    }
    if (!(0, nostr_tools_1.verifyEvent)(event)) {
        throw new HttpError(401, "Authorization event signature verification failed");
    }
    const t = findTag(event, "t");
    if (t !== expectedVerb) {
        throw new HttpError(403, `Authorization event t tag must be ${expectedVerb}`);
    }
    const expirationValue = findTag(event, "expiration");
    const expiration = expirationValue ? Number.parseInt(expirationValue, 10) : NaN;
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(expiration)) {
        throw new HttpError(401, "Authorization event missing valid expiration tag");
    }
    if (expiration < now - config.auth.maxClockSkewSeconds) {
        throw new HttpError(401, "Authorization event has expired");
    }
    return event.pubkey;
}
function normalizeHash(input) {
    const hash = input.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) {
        throw new HttpError(400, "Invalid blob hash");
    }
    return hash;
}
function hashBuffer(buffer) {
    return (0, crypto_1.createHash)("sha256").update(buffer).digest("hex");
}
function blobPath(hash) {
    return path_1.default.join(storagePath, hash);
}
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
        next(new HttpError(403, `Origin not allowed: ${origin}`));
        return;
    }
    if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,PUT,OPTIONS");
    if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
    }
    next();
});
app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "nostrmesh-blossom",
        storagePath,
        publicBaseUrl: config.server.publicBaseUrl,
        requireAuth: config.auth.requireAuth,
    });
});
app.put("/upload", express_1.default.raw({
    type: "*/*",
    limit: config.limits.maxUploadBytes,
}), (req, res, next) => {
    try {
        parseAuthEvent(req.header("Authorization"), "upload");
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            throw new HttpError(400, "Upload body is empty or invalid");
        }
        const sha256 = hashBuffer(req.body);
        const target = blobPath(sha256);
        if (!(0, fs_1.existsSync)(target)) {
            (0, fs_1.writeFileSync)(target, req.body);
        }
        res.json({
            sha256,
            size: req.body.length,
            url: `${config.server.publicBaseUrl}/${sha256}`,
        });
    }
    catch (error) {
        next(error);
    }
});
app.head("/:sha256", (req, res, next) => {
    try {
        parseAuthEvent(req.header("Authorization"), "get");
        const sha256 = normalizeHash(req.params.sha256);
        const target = blobPath(sha256);
        if (!(0, fs_1.existsSync)(target)) {
            throw new HttpError(404, "Blob not found");
        }
        res.status(200).end();
    }
    catch (error) {
        next(error);
    }
});
app.get("/:sha256", (req, res, next) => {
    try {
        parseAuthEvent(req.header("Authorization"), "get");
        const sha256 = normalizeHash(req.params.sha256);
        const target = blobPath(sha256);
        if (!(0, fs_1.existsSync)(target)) {
            throw new HttpError(404, "Blob not found");
        }
        res.setHeader("Content-Type", "application/octet-stream");
        res.sendFile(target);
    }
    catch (error) {
        next(error);
    }
});
app.use((error, _req, res, _next) => {
    if (error instanceof HttpError) {
        res.setHeader("X-Reason", error.message);
        res.status(error.status).json({ error: error.message });
        return;
    }
    if (error instanceof Error && /request entity too large/i.test(error.message)) {
        res.setHeader("X-Reason", "Upload exceeds maxUploadBytes limit");
        res.status(413).json({ error: "Upload exceeds maxUploadBytes limit" });
        return;
    }
    console.error("Unhandled Blossom error", error);
    res.setHeader("X-Reason", "Internal server error");
    res.status(500).json({ error: "Internal server error" });
});
app.listen(config.server.port, config.server.host, () => {
    console.log(`nostrmesh-blossom listening on http://${config.server.host}:${config.server.port}`);
    console.log(`storage path: ${storagePath}`);
    console.log(`auth required: ${config.auth.requireAuth}`);
});
