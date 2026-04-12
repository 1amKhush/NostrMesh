import { randomBytes } from "crypto";
import dotenv from "dotenv";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const envPath = process.env.NOSTRMESH_ENV_PATH ?? path.resolve(process.cwd(), ".env");
dotenv.config({ path: envPath });

function splitRelayUrls(input: string | undefined): string[] {
  if (!input || !input.trim()) {
    return ["ws://localhost:8008"];
  }
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isValidSecretHex(secret: string): boolean {
  return /^[a-f0-9]{64}$/i.test(secret);
}

function persistSecret(secret: string): void {
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `NOSTR_SECRET_KEY=${secret}\n`, "utf8");
    return;
  }

  const existing = readFileSync(envPath, "utf8");
  if (!/^NOSTR_SECRET_KEY=/m.test(existing)) {
    appendFileSync(envPath, `\nNOSTR_SECRET_KEY=${secret}\n`, "utf8");
  }
}

function getOrCreateSecretKey(): string {
  const current = process.env.NOSTR_SECRET_KEY?.trim();
  if (current && isValidSecretHex(current)) {
    return current.toLowerCase();
  }

  const generated = randomBytes(32).toString("hex");
  persistSecret(generated);
  return generated;
}

export interface ApiConfig {
  port: number;
  relayUrls: string[];
  blossomUrl: string;
  blossomPublicUrl: string;
  nostrSecretKey: string;
}

function normalizeUrl(input: string): string {
  return input.replace(/\/$/, "");
}

const relayUrls = splitRelayUrls(
  process.env.RELAY_URLS ?? process.env.RELAY_URL ?? "ws://nostrmesh-relay:8008"
);
const blossomUrl = normalizeUrl(process.env.BLOSSOM_URL ?? "http://nostrmesh-blossom:3000");
const blossomPublicUrl = normalizeUrl(
  process.env.BLOSSOM_PUBLIC_URL ?? "http://localhost:3000"
);

export const config: ApiConfig = {
  port: Number.parseInt(process.env.API_PORT ?? "4000", 10),
  relayUrls,
  blossomUrl,
  blossomPublicUrl,
  nostrSecretKey: getOrCreateSecretKey(),
};
