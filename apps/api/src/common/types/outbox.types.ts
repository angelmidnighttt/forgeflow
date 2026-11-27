/** An outbox event as a worker holds it after claiming it. */
export interface ClaimedOutboxEvent {
  id: string;
  organizationId: string | null;
  topic: string;
  payload: Record<string, unknown>;
  /** Claims so far, this one included. */
  attempts: number;
  /** Fencing token of this claim: needed to complete or fail the event. */
  lockToken: string;
}

/** Carries out one event; throwing makes it retried later (or dead, see PermanentOutboxError). */
export type OutboxHandler = (event: ClaimedOutboxEvent) => Promise<void>;

export interface OutboxProcessorOptions {
  /** Events claimed at once. */
  batchSize: number;
  /** How long a claim lasts before another worker may take the event over. */
  leaseSeconds: number;
  /** Attempts before an event is given up as dead. */
  maxAttempts: number;
  /**
   * How long the claims of a batch are kept (renewed every third of a lease) while it is handled.
   * Past that, a handler that hangs lets its event go: the lease runs out and another worker may
   * take it over.
   */
  maxHoldSeconds: number;
}

/** The payload of a `github.webhook` event (written by forgeflow_record_webhook_delivery). */
export interface GithubWebhookEventPayload {
  deliveryId: string;
  event: string;
  action: string | null;
  installationId: string | null;
  integrationId: string | null;
  body: Record<string, unknown>;
}
