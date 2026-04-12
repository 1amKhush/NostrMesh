"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventsRouter = void 0;
const express_1 = require("express");
const config_1 = require("../config");
const errors_1 = require("../errors");
const schema_1 = require("../metadata/schema");
const client_1 = require("../nostr/client");
exports.eventsRouter = (0, express_1.Router)();
function relayQueryRetryOptions() {
    return {
        attempts: config_1.config.relayQueryAttempts,
        baseDelayMs: config_1.config.relayRetryBaseDelayMs,
    };
}
function normalizeEventId(input) {
    const eventId = input.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(eventId)) {
        throw new errors_1.ApiError(400, "invalid_event_id", "Invalid eventId format");
    }
    return eventId;
}
function normalizeHashQuery(input) {
    if (typeof input !== "string") {
        throw new errors_1.ApiError(400, "missing_hash", "Missing query parameter: hash");
    }
    const hash = input.trim().toLowerCase();
    if (!hash) {
        throw new errors_1.ApiError(400, "missing_hash", "Missing query parameter: hash");
    }
    if (!/^[a-f0-9]{64}$/.test(hash)) {
        throw new errors_1.ApiError(400, "invalid_hash", "Invalid hash format");
    }
    return hash;
}
exports.eventsRouter.get("/:eventId", async (req, res, next) => {
    try {
        const eventId = normalizeEventId(req.params.eventId);
        let event;
        try {
            event = await (0, client_1.fetchEventById)(eventId, config_1.config.relayUrls, relayQueryRetryOptions());
        }
        catch (error) {
            throw new errors_1.ApiError(502, (0, errors_1.relayErrorCode)(error, "query"), (0, errors_1.relayErrorMessage)(error, "query"));
        }
        if (!event) {
            throw new errors_1.ApiError(404, "event_not_found", "Event not found");
        }
        let metadata;
        try {
            metadata = (0, schema_1.parseMetadataEvent)(event, config_1.config.nostrSecretKey);
        }
        catch (error) {
            throw new errors_1.ApiError(422, "invalid_metadata_event", `Event metadata parse failed: ${(0, errors_1.errorMessage)(error)}`);
        }
        res.json({
            eventId,
            event,
            metadata,
        });
    }
    catch (error) {
        next(error);
    }
});
exports.eventsRouter.get("/", async (req, res, next) => {
    try {
        const hash = normalizeHashQuery(req.query.hash);
        let events;
        try {
            events = await (0, client_1.fetchEvents)((0, schema_1.metadataFilterByHash)(hash), config_1.config.relayUrls, relayQueryRetryOptions());
        }
        catch (error) {
            throw new errors_1.ApiError(502, (0, errors_1.relayErrorCode)(error, "query"), (0, errors_1.relayErrorMessage)(error, "query"));
        }
        const parsedEvents = events.map((event) => {
            try {
                return {
                    event,
                    metadata: (0, schema_1.parseMetadataEvent)(event, config_1.config.nostrSecretKey),
                };
            }
            catch (error) {
                throw new errors_1.ApiError(422, "invalid_metadata_event", `Event metadata parse failed: ${(0, errors_1.errorMessage)(error)}`);
            }
        });
        res.json({
            hash,
            events: parsedEvents,
        });
    }
    catch (error) {
        next(error);
    }
});
