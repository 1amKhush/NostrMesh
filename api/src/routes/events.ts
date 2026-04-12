import { Router, type Request, type Response, type NextFunction } from "express";
import { config } from "../config";
import { ApiError, relayErrorCode, relayErrorMessage } from "../errors";
import { metadataFilterByHash } from "../metadata/schema";
import { fetchEventById, fetchEvents } from "../nostr/client";

export const eventsRouter = Router();

eventsRouter.get("/:eventId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventId = req.params.eventId.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(eventId)) {
      throw new ApiError(400, "invalid_event_id", "Invalid eventId format");
    }

    let event;
    try {
      event = await fetchEventById(eventId, config.relayUrls);
    } catch (error) {
      throw new ApiError(502, relayErrorCode(error, "query"), relayErrorMessage(error, "query"));
    }

    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.json({ event });
  } catch (error) {
    next(error);
  }
});

eventsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hash = typeof req.query.hash === "string" ? req.query.hash.trim().toLowerCase() : "";
    if (!hash) {
      res.status(400).json({ error: "Missing query parameter: hash" });
      return;
    }
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      res.status(400).json({ error: "Invalid hash format" });
      return;
    }

    let events;
    try {
      events = await fetchEvents(metadataFilterByHash(hash), config.relayUrls);
    } catch (error) {
      throw new ApiError(502, relayErrorCode(error, "query"), relayErrorMessage(error, "query"));
    }

    res.json({ events });
  } catch (error) {
    next(error);
  }
});
