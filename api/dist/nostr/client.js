"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishEvent = publishEvent;
exports.fetchEvents = fetchEvents;
exports.fetchEventById = fetchEventById;
const nostr_tools_1 = require("nostr-tools");
const errors_1 = require("../errors");
const pool = new nostr_tools_1.SimplePool();
const MAX_BACKOFF_MS = 4000;
function dTag(event) {
    const tag = event.tags.find((entry) => entry[0] === "d");
    return tag?.[1];
}
function dedupeEvents(events) {
    const sorted = [...events].sort((a, b) => b.created_at - a.created_at);
    const byKey = new Map();
    for (const event of sorted) {
        const key = dTag(event) ? `d:${dTag(event)}` : `id:${event.id}`;
        if (!byKey.has(key)) {
            byKey.set(key, event);
        }
    }
    return [...byKey.values()].sort((a, b) => b.created_at - a.created_at);
}
function ensureRelayUrls(relayUrls) {
    if (relayUrls.length === 0) {
        throw new Error("No relay URLs configured");
    }
}
function retryDelayMs(baseDelayMs, attempt) {
    return Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
}
async function wait(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
async function withRelayRetry(action, options, execute) {
    const errors = [];
    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
        try {
            return await execute();
        }
        catch (error) {
            errors.push(error);
            if (attempt >= options.attempts) {
                const reason = (0, errors_1.errorMessage)(error);
                throw new AggregateError(errors, `Relay ${action} failed after ${options.attempts} attempts: ${reason}`);
            }
            await wait(retryDelayMs(options.baseDelayMs, attempt));
        }
    }
    throw new Error(`Relay ${action} failed unexpectedly`);
}
async function publishEvent(event, relayUrls, retry) {
    ensureRelayUrls(relayUrls);
    await withRelayRetry("publish", retry, async () => {
        const publishPromises = pool.publish(relayUrls, event);
        await Promise.any(publishPromises);
    });
}
async function fetchEvents(filter, relayUrls, retry) {
    ensureRelayUrls(relayUrls);
    const events = await withRelayRetry("query", retry, async () => pool.querySync(relayUrls, filter));
    return dedupeEvents(events);
}
async function fetchEventById(eventId, relayUrls, retry) {
    const events = await fetchEvents({
        ids: [eventId],
        limit: 1,
    }, relayUrls, retry);
    return events.length > 0 ? events[0] : null;
}
