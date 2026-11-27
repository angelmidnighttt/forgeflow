import { z } from 'zod';

export const OUTBOX_EVENT_STATUSES = ['pending', 'processing', 'done', 'dead'] as const;
export const outboxEventStatusSchema = z.enum(OUTBOX_EVENT_STATUSES);

/** Background work as the integrations page shows it (dead events, with retry). */
export const outboxEventSchema = z.object({
  id: z.uuid(),
  topic: z.string(),
  status: outboxEventStatusSchema,
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  /** What it is about, e.g. the GitHub event name. */
  summary: z.string().nullable(),
  createdAt: z.iso.datetime(),
  processedAt: z.iso.datetime().nullable(),
});
export type OutboxEvent = z.infer<typeof outboxEventSchema>;

/** A webhook received for an integration, with how its handling went. */
export const webhookDeliverySchema = z.object({
  id: z.uuid(),
  /** The provider's delivery id (X-GitHub-Delivery). */
  deliveryId: z.string(),
  event: z.string(),
  action: z.string().nullable(),
  receivedAt: z.iso.datetime(),
  status: outboxEventStatusSchema.nullable(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;
