import { createHash } from "crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import yaml from "js-yaml";
import path from "path";
import { verifyEvent } from "nostr-tools";

type AuthVerb = "upload" | "get";

interface BlossomConfig {
  server: {
    host: string;
    port: number;
    publicBaseUrl: string;
  };
  storage: {
    path: string;
  };
  limits: {
    maxUploadBytes: number;
  };
  cors: {
    allowedOrigins: string[];
  };
  auth: {
    requireAuth: boolean;
    maxClockSkewSeconds: number;
  };
}

interface NostrAuthEvent {
  id?: string;
  sig?: string;
  pubkey?: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content?: string;
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const defaultConfig: BlossomConfig = {
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

function loadConfig(): BlossomConfig {
  const configPath = process.env.BLOSSOM_CONFIG ?? path.resolve(process.cwd(), "config.yml");
  const envPublicBaseUrl = process.env.BLOSSOM_PUBLIC_URL?.replace(/\/$/, "");
  if (!existsSync(configPath)) {
    return {
      ...defaultConfig,
      server: {
        ...defaultConfig.server,
        publicBaseUrl: envPublicBaseUrl ?? defaultConfig.server.publicBaseUrl,
      },
    };
  }

  const loaded = yaml.load(readFileSync(configPath, "utf8")) as Partial<BlossomConfig>;
  return {
    server: {
      host: loaded.server?.host ?? defaultConfig.server.host,
      port: loaded.server?.port ?? defaultConfig.server.port,
      publicBaseUrl:
        envPublicBaseUrl ?? loaded.server?.publicBaseUrl ?? defaultConfig.server.publicBaseUrl,
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
const storagePath = path.resolve(config.storage.path);
mkdirSync(storagePath, { recursive: true });

const app = express();

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }
  if (config.cors.allowedOrigins.includes("*")) {
    return true;
  }
  return config.cors.allowedOrigins.includes(origin);
}

function findTag(event: NostrAuthEvent, key: string): string | undefined {
  const tag = event.tags.find((entry) => entry[0] === key);
  return tag?.[1];
}

function parseAuthEvent(headerValue: string | undefined, expectedVerb: AuthVerb): string {
  if (!config.auth.requireAuth) {
    return "anonymous";
  }

  if (!headerValue || !headerValue.startsWith("Nostr ")) {
    throw new HttpError(401, "Missing or invalid Authorization header");
  }

  const encoded = headerValue.slice("Nostr ".length).trim();
  let event: NostrAuthEvent;
  try {
    event = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as NostrAuthEvent;
  } catch {
    throw new HttpError(401, "Authorization payload is not valid base64 JSON");
  }

  if (event.kind !== 24242) {
    throw new HttpError(401, "Authorization event kind must be 24242");
  }

  if (!event.id || !event.sig || !event.pubkey) {
    throw new HttpError(401, "Authorization event missing id, sig, or pubkey");
  }

  if (!verifyEvent(event as any)) {
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

function normalizeHash(input: string): string {
  const hash = input.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new HttpError(400, "Invalid blob hash");
  }
  return hash;
}

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function blobPath(hash: string): string {
  return path.join(storagePath, hash);
}

app.use((req: Request, res: Response, next: NextFunction) => {
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

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "nostrmesh-blossom",
    storagePath,
    publicBaseUrl: config.server.publicBaseUrl,
    requireAuth: config.auth.requireAuth,
  });
});

app.put(
  "/upload",
  express.raw({
    type: "*/*",
    limit: config.limits.maxUploadBytes,
  }),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      parseAuthEvent(req.header("Authorization"), "upload");

      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new HttpError(400, "Upload body is empty or invalid");
      }

      const sha256 = hashBuffer(req.body);
      const target = blobPath(sha256);

      if (!existsSync(target)) {
        writeFileSync(target, req.body);
      }

      res.json({
        sha256,
        size: req.body.length,
        url: `${config.server.publicBaseUrl}/${sha256}`,
      });
    } catch (error) {
      next(error);
    }
  }
);

app.head("/:sha256", (req: Request, res: Response, next: NextFunction) => {
  try {
    parseAuthEvent(req.header("Authorization"), "get");
    const sha256 = normalizeHash(req.params.sha256);
    const target = blobPath(sha256);

    if (!existsSync(target)) {
      throw new HttpError(404, "Blob not found");
    }

    res.status(200).end();
  } catch (error) {
    next(error);
  }
});

app.get("/:sha256", (req: Request, res: Response, next: NextFunction) => {
  try {
    parseAuthEvent(req.header("Authorization"), "get");
    const sha256 = normalizeHash(req.params.sha256);
    const target = blobPath(sha256);

    if (!existsSync(target)) {
      throw new HttpError(404, "Blob not found");
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.sendFile(target);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
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
  console.log(
    `nostrmesh-blossom listening on http://${config.server.host}:${config.server.port}`
  );
  console.log(`storage path: ${storagePath}`);
  console.log(`auth required: ${config.auth.requireAuth}`);
});
