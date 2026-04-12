import { Router, type Request, type Response, type NextFunction } from "express";
import { config } from "../config";
import { ApiError, errorMessage, relayErrorCode, relayErrorMessage } from "../errors";
import { metadataFilterByHash, parseMetadataEvent } from "../metadata/schema";
import { fetchEventById, fetchEvents } from "../nostr/client";

export const eventsRouter = Router();

function relayQueryRetryOptions(): { attempts: number; baseDelayMs: number } {
  return {
    attempts: config.relayQueryAttempts,
    baseDelayMs: config.relayRetryBaseDelayMs,
  };
}

function normalizeEventId(input: string): string {
  const eventId = input.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(eventId)) {
    throw new ApiError(400, "invalid_event_id", "Invalid eventId format");
  }
  return eventId;
}

function normalizeHashQuery(input: unknown): string {
  if (typeof input !== "string") {
    throw new ApiError(400, "missing_hash", "Missing query parameter: hash");
  }

  const hash = input.trim().toLowerCase();
  if (!hash) {
    throw new ApiError(400, "missing_hash", "Missing query parameter: hash");
  }

  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new ApiError(400, "invalid_hash", "Invalid hash format");
  }

  return hash;
}

eventsRouter.get("/:eventId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = normalizeEventId(req.params.eventId);

    let event;
    try {
      event = await fetchEventById(eventId, config.relayUrls, relayQueryRetryOptions());
    } catch (error) {
      throw new ApiError(502, relayErrorCode(error, "query"), relayErrorMessage(error, "query"));
    }

    if (!event) {
      throw new ApiError(404, "event_not_found", "Event not found");
    }

    let metadata;
    try {
      metadata = parseMetadataEvent(event, config.nostrSecretKey);
    } catch (error) {
      throw new ApiError(422, "invalid_metadata_event", `Event metadata parse failed: ${errorMessage(error)}`);
    }

    res.json({
      eventId,
      event,
      metadata,
    });
  } catch (error) {
    next(error);
  }
});

eventsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hash = normalizeHashQuery(req.query.hash);

    let events;
    try {
      events = await fetchEvents(metadataFilterByHash(hash), config.relayUrls, relayQueryRetryOptions());
    } catch (error) {
      throw new ApiError(502, relayErrorCode(error, "query"), relayErrorMessage(error, "query"));
    }

    const parsedEvents = events.map((event) => {
      try {
        return {
          event,
          metadata: parseMetadataEvent(event, config.nostrSecretKey),
        };
      } catch (error) {
        throw new ApiError(422, "invalid_metadata_event", `Event metadata parse failed: ${errorMessage(error)}`);
      }
    });

    res.json({
      hash,
      events: parsedEvents,
    });
  } catch (error) {
    next(error);
  }
});
