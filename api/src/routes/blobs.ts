import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { config } from "../config";
import { ApiError, relayErrorCode, relayErrorMessage } from "../errors";
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
const blossomClient = new BlossomClient(config.blossomUrl, config.nostrSecretKey);

export const blobsRouter = Router();

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
    events = await fetchEvents(metadataFilterByHash(hash), config.relayUrls);
  } catch (error) {
    throw new ApiError(502, relayErrorCode(error, "query"), relayErrorMessage(error, "query"));
  }

  if (events.length === 0) {
    return null;
  }
  return parseMetadataEvent(events[0], config.nostrSecretKey);
}

blobsRouter.post(
  "/",
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Missing file upload field 'file'" });
        return;
      }

      const folder = normalizeFolder(req.body.folder);
      const encrypted = encryptBlob(req.file.buffer);
      const uploaded = await blossomClient.uploadBlob(encrypted.ciphertext, req.file.originalname);

      const metadata: BlobMetadata = {
        name: req.file.originalname,
        hash: uploaded.sha256,
        size: req.file.size,
        type: req.file.mimetype || "application/octet-stream",
        folder,
        uploadedAt: Math.floor(Date.now() / 1000),
        server: config.blossomPublicUrl,
        encryptionKey: encrypted.encryptionKey,
      };

      const metadataEvent = buildMetadataEvent(metadata, config.nostrSecretKey);
      try {
        await publishEvent(metadataEvent, config.relayUrls);
      } catch (error) {
        throw new ApiError(502, relayErrorCode(error, "publish"), relayErrorMessage(error, "publish"));
      }

      res.status(201).json({
        eventId: metadataEvent.id,
        hash: metadata.hash,
        downloadUrl: `/blobs/${metadata.hash}/download`,
        metadata,
      });
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
  } catch (error) {
    next(error);
  }
});

blobsRouter.get("/:hash/download", async (req: Request, res: Response, next: NextFunction) => {
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
      res.status(404).json({ error: "Metadata not found" });
      return;
    }

    const deleteEvent = buildSoftDeleteEvent(metadata, config.nostrSecretKey);
    try {
      await publishEvent(deleteEvent, config.relayUrls);
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
