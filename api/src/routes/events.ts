import { Router, type Request, type Response, type NextFunction } from "express";
import { config } from "../config";
import { metadataFilterByHash } from "../metadata/schema";
import { fetchEventById, fetchEvents } from "../nostr/client";

export const eventsRouter = Router();

eventsRouter.get("/:eventId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const event = await fetchEventById(req.params.eventId, config.relayUrls);
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

    const events = await fetchEvents(metadataFilterByHash(hash), config.relayUrls);
    res.json({ events });
  } catch (error) {
    next(error);
  }
});
