/**
 * Thrown by an outbox handler for an event that can never succeed (malformed payload, unknown
 * topic): the event goes to dead at once instead of being retried.
 */
export class PermanentOutboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentOutboxError';
  }
}

/** Wait before attempt `attempts + 1`: 10 s, 20 s, 40 s… up to an hour, with ±20 % jitter. */
export function outboxBackoffMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(10_000 * 2 ** Math.max(0, attempts - 1), 60 * 60 * 1000);
  return Math.round(base * (0.8 + 0.4 * random()));
}
