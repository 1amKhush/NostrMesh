"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const crypto_1 = require("crypto");
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const envPath = process.env.NOSTRMESH_ENV_PATH ?? path_1.default.resolve(process.cwd(), ".env");
dotenv_1.default.config({ path: envPath });
function splitRelayUrls(input) {
    if (!input || !input.trim()) {
        return ["ws://localhost:8008"];
    }
    return input
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
}
function isValidSecretHex(secret) {
    return /^[a-f0-9]{64}$/i.test(secret);
}
function persistSecret(secret) {
    if (!(0, fs_1.existsSync)(envPath)) {
        (0, fs_1.writeFileSync)(envPath, `NOSTR_SECRET_KEY=${secret}\n`, "utf8");
        return;
    }
    const existing = (0, fs_1.readFileSync)(envPath, "utf8");
    if (!/^NOSTR_SECRET_KEY=/m.test(existing)) {
        (0, fs_1.appendFileSync)(envPath, `\nNOSTR_SECRET_KEY=${secret}\n`, "utf8");
    }
}
function getOrCreateSecretKey() {
    const current = process.env.NOSTR_SECRET_KEY?.trim();
    if (current && isValidSecretHex(current)) {
        return current.toLowerCase();
    }
    const generated = (0, crypto_1.randomBytes)(32).toString("hex");
    persistSecret(generated);
    return generated;
}
function normalizeUrl(input) {
    return input.replace(/\/$/, "");
}
const relayUrls = splitRelayUrls(process.env.RELAY_URLS ?? process.env.RELAY_URL ?? "ws://nostrmesh-relay:8008");
const blossomUrl = normalizeUrl(process.env.BLOSSOM_URL ?? "http://nostrmesh-blossom:3000");
const blossomPublicUrl = normalizeUrl(process.env.BLOSSOM_PUBLIC_URL ?? "http://localhost:3000");
exports.config = {
    port: Number.parseInt(process.env.API_PORT ?? "4000", 10),
    relayUrls,
    blossomUrl,
    blossomPublicUrl,
    nostrSecretKey: getOrCreateSecretKey(),
};
