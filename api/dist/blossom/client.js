"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlossomClient = void 0;
const axios_1 = __importStar(require("axios"));
const nostr_tools_1 = require("nostr-tools");
const errors_1 = require("../errors");
class BlossomClient {
    constructor(baseUrl, secretKeyHex) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.secretKeyHex = secretKeyHex;
    }
    buildAuthHeader(verb, content, expirationSeconds = 60) {
        const secretKey = hexToBytes(this.secretKeyHex);
        const now = Math.floor(Date.now() / 1000);
        const template = {
            kind: 24242,
            created_at: now,
            tags: [
                ["t", verb],
                ["expiration", String(now + expirationSeconds)],
            ],
            content,
        };
        const signed = (0, nostr_tools_1.finalizeEvent)(template, secretKey);
        const encoded = Buffer.from(JSON.stringify(signed), "utf8").toString("base64");
        return `Nostr ${encoded}`;
    }
    async uploadBlob(payload, filename) {
        const authHeader = this.buildAuthHeader("upload", `Upload ${filename}`);
        try {
            const response = await axios_1.default.put(`${this.baseUrl}/upload`, payload, {
                headers: {
                    Authorization: authHeader,
                    "Content-Type": "application/octet-stream",
                },
                validateStatus: () => true,
            });
            if (response.status < 200 || response.status >= 300) {
                const reason = response.headers["x-reason"] || response.statusText;
                throw new errors_1.ApiError(mapBlossomStatus(response.status, 502), "blossom_upload_failed", `Blossom upload failed: ${reason}`);
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
        }
        catch (error) {
            throw normalizeBlossomError(error, "upload");
        }
    }
    async downloadBlob(sha256) {
        const authHeader = this.buildAuthHeader("get", `Get ${sha256}`);
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/${sha256}`, {
                headers: {
                    Authorization: authHeader,
                },
                responseType: "arraybuffer",
                validateStatus: () => true,
            });
            if (response.status < 200 || response.status >= 300) {
                const reason = response.headers["x-reason"] || response.statusText;
                throw new errors_1.ApiError(mapBlossomStatus(response.status, 502), "blossom_download_failed", `Blossom download failed: ${reason}`);
            }
            return Buffer.from(response.data);
        }
        catch (error) {
            throw normalizeBlossomError(error, "download");
        }
    }
    async checkBlob(sha256) {
        const authHeader = this.buildAuthHeader("get", `Head ${sha256}`);
        try {
            const response = await axios_1.default.head(`${this.baseUrl}/${sha256}`, {
                headers: {
                    Authorization: authHeader,
                },
                validateStatus: () => true,
            });
            return response.status >= 200 && response.status < 300;
        }
        catch (error) {
            throw normalizeBlossomError(error, "head");
        }
    }
}
exports.BlossomClient = BlossomClient;
function hexToBytes(value) {
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
function normalizeBlossomError(error, operation) {
    if (error instanceof errors_1.ApiError) {
        return error;
    }
    if (error instanceof axios_1.AxiosError) {
        if (!error.response) {
            return new errors_1.ApiError(502, `blossom_${operation}_network_error`, `Blossom ${operation} failed: network or CORS issue`);
        }
        const reason = (typeof error.response.data === "object" && error.response.data && "error" in error.response.data
            ? String(error.response.data.error)
            : undefined) ||
            String(error.response.headers["x-reason"] || error.response.statusText);
        return new errors_1.ApiError(mapBlossomStatus(error.response.status, 502), `blossom_${operation}_failed`, `Blossom ${operation} failed: ${reason}`);
    }
    if (error instanceof Error) {
        return new errors_1.ApiError(502, `blossom_${operation}_failed`, error.message);
    }
    return new errors_1.ApiError(502, `blossom_${operation}_failed`, `Blossom ${operation} failed`);
}
function mapBlossomStatus(status, fallback) {
    if (status >= 400 && status < 500) {
        return status;
    }
    if (status >= 500 && status < 600) {
        return 502;
    }
    return fallback;
}
