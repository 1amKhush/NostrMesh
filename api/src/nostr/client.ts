import { SimplePool, type Event, type Filter } from "nostr-tools";

const pool = new SimplePool();

function dTag(event: Event): string | undefined {
  const tag = event.tags.find((entry) => entry[0] === "d");
  return tag?.[1];
}

function dedupeEvents(events: Event[]): Event[] {
  const sorted = [...events].sort((a, b) => b.created_at - a.created_at);
  const byKey = new Map<string, Event>();

  for (const event of sorted) {
    const key = dTag(event) ? `d:${dTag(event)}` : `id:${event.id}`;
    if (!byKey.has(key)) {
      byKey.set(key, event);
    }
  }

  return [...byKey.values()].sort((a, b) => b.created_at - a.created_at);
}

export async function publishEvent(event: Event, relayUrls: string[]): Promise<void> {
  const publishPromises = pool.publish(relayUrls, event);
  await Promise.any(publishPromises);
}

export async function fetchEvents(filter: Filter, relayUrls: string[]): Promise<Event[]> {
  const events = await pool.querySync(relayUrls, filter);
  return dedupeEvents(events as Event[]);
}

export async function fetchEventById(eventId: string, relayUrls: string[]): Promise<Event | null> {
  const events = await fetchEvents(
    {
      ids: [eventId],
      limit: 1,
    },
    relayUrls
  );
  return events.length > 0 ? events[0] : null;
}
