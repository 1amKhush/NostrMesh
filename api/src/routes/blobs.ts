import { createHash } from "crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { config } from "../config";
import { ApiError, errorMessage, relayErrorCode, relayErrorMessage } from "../errors";
import { BlossomClient } from "../blossom/client";
import { decryptBlob, encryptBlob } from "../crypto";
import {
  buildMetadataEvent,
  buildSoftDeleteEvent,
  metadataFilterByHash,
  parseMetadataEvent,
  type BlobMetadata,
} from "../metadata/schema";
import { fetchEvents, publishEvent } from "../nostr/client";

const upload = multer({ storage: multer.memoryStorage() });
const blossomClient = new BlossomClient(config.blossomUrl, config.nostrSecretKey, {
  uploadAttempts: config.blossomUploadAttempts,
  downloadAttempts: config.blossomDownloadAttempts,
  baseDelayMs: config.blossomRetryBaseDelayMs,
});

interface CachedUploadResponse {
  status: number;
  body: unknown;
  expiresAt: number;
  fingerprint: string;
}

const uploadIdempotencyCache = new Map<string, CachedUploadResponse>();

export const blobsRouter = Router();

function relayPublishRetryOptions(): { attempts: number; baseDelayMs: number } {
  return {
    attempts: config.relayPublishAttempts,
    baseDelayMs: config.relayRetryBaseDelayMs,
  };
}

function relayQueryRetryOptions(): { attempts: number; baseDelayMs: number } {
  return {
    attempts: config.relayQueryAttempts,
    baseDelayMs: config.relayRetryBaseDelayMs,
  };
}

function pruneIdempotencyCache(now: number): void {
  for (const [key, value] of uploadIdempotencyCache.entries()) {
    if (value.expiresAt <= now) {
      uploadIdempotencyCache.delete(key);
    }
  }
}

function enforceIdempotencyCapacity(maxEntries: number): void {
  while (uploadIdempotencyCache.size > maxEntries) {
    const oldest = uploadIdempotencyCache.keys().next().value;
    if (!oldest) {
      return;
    }
    uploadIdempotencyCache.delete(oldest);
  }
}

function uploadFingerprint(file: Express.Multer.File, folder: string): string {
  return createHash("sha256")
    .update(file.originalname)
    .update("\n")
    .update(file.mimetype || "application/octet-stream")
    .update("\n")
    .update(folder)
    .update("\n")
    .update(file.buffer)
    .digest("hex");
}

function parseIdempotencyKey(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }

  const value = input.trim();
  if (!value) {
    return undefined;
  }

  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new ApiError(
      400,
      "invalid_idempotency_key",
      "Idempotency-Key must match [A-Za-z0-9._:-] and be at most 128 chars"
    );
  }

  return value;
}

function normalizeHash(hash: string): string {
  const normalized = hash.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new ApiError(400, "invalid_hash", "Invalid hash format");
  }
  return normalized;
}

function normalizeFolder(input: unknown): string {
  if (input === undefined || input === null) {
    return "/";
  }

  if (typeof input !== "string") {
    throw new ApiError(400, "invalid_folder", "Folder must be a string path");
  }

  const folder = input.trim();
  if (!folder) {
    return "/";
  }

  if (!folder.startsWith("/")) {
    throw new ApiError(400, "invalid_folder", "Folder must start with '/'");
  }

  return folder;
}

async function resolveMetadata(hash: string): Promise<BlobMetadata | null> {
  let events;
  try {
    events = await fetchEvents(metadataFilterByHash(hash), config.relayUrls, relayQueryRetryOptions());
  } catch (error) {
    throw new ApiError(502, relayErrorCode(error, "query"), relayErrorMessage(error, "query"));
  }

  if (events.length === 0) {
    return null;
  }

  try {
    return parseMetadataEvent(events[0], config.nostrSecretKey);
  } catch (error) {
    throw new ApiError(422, "invalid_metadata_event", `Stored metadata event is invalid: ${errorMessage(error)}`);
  }
}

blobsRouter.post(
  "/",
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const now = Date.now();
      pruneIdempotencyCache(now);
      const idempotencyKey = parseIdempotencyKey(req.header("Idempotency-Key") ?? undefined);
      let folder: string | undefined;
      let fingerprint: string | undefined;

      if (req.file) {
        folder = normalizeFolder(req.body.folder);
        fingerprint = uploadFingerprint(req.file, folder);
      }

      if (idempotencyKey) {
        const cached = uploadIdempotencyCache.get(idempotencyKey);
        if (cached && cached.expiresAt > now) {
          if (fingerprint && cached.fingerprint !== fingerprint) {
            throw new ApiError(
              409,
              "idempotency_key_conflict",
              "Idempotency-Key replay payload does not match the original request"
            );
          }
          res.status(cached.status).json(cached.body);
          return;
        }
      }

      if (!req.file) {
        throw new ApiError(400, "missing_file", "Missing file upload field 'file'");
      }

      const resolvedFolder = folder ?? normalizeFolder(req.body.folder);
      const resolvedFingerprint = fingerprint ?? uploadFingerprint(req.file, resolvedFolder);
      const encrypted = encryptBlob(req.file.buffer);
      const uploaded = await blossomClient.uploadBlob(encrypted.ciphertext, req.file.originalname);

      const metadata: BlobMetadata = {
        name: req.file.originalname,
        hash: uploaded.sha256,
        size: req.file.size,
        type: req.file.mimetype || "application/octet-stream",
        folder: resolvedFolder,
        uploadedAt: Math.floor(Date.now() / 1000),
        server: config.blossomPublicUrl,
        encryptionKey: encrypted.encryptionKey,
      };

      const metadataEvent = buildMetadataEvent(metadata, config.nostrSecretKey);
      try {
        await publishEvent(metadataEvent, config.relayUrls, relayPublishRetryOptions());
      } catch (error) {
        throw new ApiError(502, relayErrorCode(error, "publish"), relayErrorMessage(error, "publish"));
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
          expiresAt: now + config.idempotencyTtlSeconds * 1000,
          fingerprint: resolvedFingerprint,
        });
        enforceIdempotencyCapacity(config.idempotencyMaxEntries);
      }

      res.status(201).json(responseBody);
    } catch (error) {
      next(error);
    }
  }
);

blobsRouter.get("/:hash", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hash = normalizeHash(req.params.hash);
    const metadata = await resolveMetadata(hash);

    if (!metadata) {
      throw new ApiError(404, "metadata_not_found", "Metadata not found");
    }

    if (metadata.deleted) {
      throw new ApiError(410, "metadata_deleted", "Blob metadata is marked deleted");
    }

    res.json({
      metadata,
      downloadUrl: `/blobs/${hash}/download`,
    });
  } catch (error) {
    next(error);
  }
});

blobsRouter.get("/:hash/download", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hash = normalizeHash(req.params.hash);
    const metadata = await resolveMetadata(hash);

    if (!metadata) {
      throw new ApiError(404, "blob_not_found", "Blob not found");
    }

    if (metadata.deleted) {
      throw new ApiError(410, "blob_deleted", "Blob metadata is marked deleted");
    }

    const encryptedPayload = await blossomClient.downloadBlob(hash);
    const decrypted = decryptBlob(encryptedPayload, metadata.encryptionKey);

    res.setHeader("Content-Type", metadata.type || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename=\"${metadata.name}\"`);
    res.send(decrypted);
  } catch (error) {
    next(error);
  }
});

blobsRouter.delete("/:hash", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hash = normalizeHash(req.params.hash);
    const metadata = await resolveMetadata(hash);

    if (!metadata) {
      throw new ApiError(404, "metadata_not_found", "Metadata not found");
    }

    if (metadata.deleted) {
      res.json({
        hash,
        deleted: true,
        alreadyDeleted: true,
      });
      return;
    }

    const deleteEvent = buildSoftDeleteEvent(metadata, config.nostrSecretKey);
    try {
      await publishEvent(deleteEvent, config.relayUrls, relayPublishRetryOptions());
    } catch (error) {
      throw new ApiError(502, relayErrorCode(error, "publish"), relayErrorMessage(error, "publish"));
    }

    res.json({
      hash,
      deleted: true,
      eventId: deleteEvent.id,
    });
  } catch (error) {
    next(error);
  }
});
