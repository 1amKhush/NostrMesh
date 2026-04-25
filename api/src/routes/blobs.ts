import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { config } from "../config";
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
    throw new Error("Invalid hash format");
  }
  return normalized;
}

async function resolveMetadata(hash: string): Promise<BlobMetadata | null> {
  const events = await fetchEvents(metadataFilterByHash(hash), config.relayUrls);
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

      const folder = typeof req.body.folder === "string" && req.body.folder.trim() ? req.body.folder : "/";
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
      await publishEvent(metadataEvent, config.relayUrls);

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
      res.status(404).json({ error: "Blob not found" });
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
    await publishEvent(deleteEvent, config.relayUrls);

    res.json({
      hash,
      deleted: true,
      eventId: deleteEvent.id,
    });
  } catch (error) {
    next(error);
  }
});
