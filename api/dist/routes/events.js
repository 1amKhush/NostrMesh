"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventsRouter = void 0;
const express_1 = require("express");
const config_1 = require("../config");
const schema_1 = require("../metadata/schema");
const client_1 = require("../nostr/client");
exports.eventsRouter = (0, express_1.Router)();
exports.eventsRouter.get("/:eventId", async (req, res, next) => {
    try {
        const event = await (0, client_1.fetchEventById)(req.params.eventId, config_1.config.relayUrls);
        if (!event) {
            res.status(404).json({ error: "Event not found" });
            return;
        }
        res.json({ event });
    }
    catch (error) {
        next(error);
    }
});
exports.eventsRouter.get("/", async (req, res, next) => {
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
        const events = await (0, client_1.fetchEvents)((0, schema_1.metadataFilterByHash)(hash), config_1.config.relayUrls);
        res.json({ events });
    }
    catch (error) {
        next(error);
    }
});
