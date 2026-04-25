"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishEvent = publishEvent;
exports.fetchEvents = fetchEvents;
exports.fetchEventById = fetchEventById;
const nostr_tools_1 = require("nostr-tools");
const pool = new nostr_tools_1.SimplePool();
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
async function publishEvent(event, relayUrls) {
    const publishPromises = pool.publish(relayUrls, event);
    await Promise.any(publishPromises);
}
async function fetchEvents(filter, relayUrls) {
    const events = await pool.querySync(relayUrls, filter);
    return dedupeEvents(events);
}
async function fetchEventById(eventId, relayUrls) {
    const events = await fetchEvents({
        ids: [eventId],
        limit: 1,
    }, relayUrls);
    return events.length > 0 ? events[0] : null;
}
