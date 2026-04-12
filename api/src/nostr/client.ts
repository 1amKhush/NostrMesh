import { SimplePool, type Event, type Filter } from "nostr-tools";
import { errorMessage } from "../errors";

const pool = new SimplePool();

const MAX_BACKOFF_MS = 4000;

export interface RelayRetryOptions {
  attempts: number;
  baseDelayMs: number;
}

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

function ensureRelayUrls(relayUrls: string[]): void {
  if (relayUrls.length === 0) {
    throw new Error("No relay URLs configured");
  }
}

function retryDelayMs(baseDelayMs: number, attempt: number): number {
  return Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRelayRetry<T>(
  action: "publish" | "query",
  options: RelayRetryOptions,
  execute: () => Promise<T>
): Promise<T> {
  const errors: unknown[] = [];

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await execute();
    } catch (error) {
      errors.push(error);
      if (attempt >= options.attempts) {
        const reason = errorMessage(error);
        throw new AggregateError(errors, `Relay ${action} failed after ${options.attempts} attempts: ${reason}`);
      }
      await wait(retryDelayMs(options.baseDelayMs, attempt));
    }
  }

  throw new Error(`Relay ${action} failed unexpectedly`);
}

export async function publishEvent(
  event: Event,
  relayUrls: string[],
  retry: RelayRetryOptions
): Promise<void> {
  ensureRelayUrls(relayUrls);
  await withRelayRetry("publish", retry, async () => {
    const publishPromises = pool.publish(relayUrls, event);
    await Promise.any(publishPromises);
  });
}

export async function fetchEvents(
  filter: Filter,
  relayUrls: string[],
  retry: RelayRetryOptions
): Promise<Event[]> {
  ensureRelayUrls(relayUrls);
  const events = await withRelayRetry("query", retry, async () => pool.querySync(relayUrls, filter));
  return dedupeEvents(events as Event[]);
}

export async function fetchEventById(
  eventId: string,
  relayUrls: string[],
  retry: RelayRetryOptions
): Promise<Event | null> {
  const events = await fetchEvents(
    {
      ids: [eventId],
      limit: 1,
    },
    relayUrls,
    retry
  );
  return events.length > 0 ? events[0] : null;
}
