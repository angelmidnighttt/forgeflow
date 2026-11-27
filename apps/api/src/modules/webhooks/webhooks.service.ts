import { Inject, Injectable } from '@nestjs/common';
import type { WebhookDelivery } from '@forgeflow/contracts';
import { outboxEvents, webhookDeliveries, type DatabaseHandle } from '@forgeflow/database';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DATABASE } from '../../common/constants/injection-tokens.js';

export interface IncomingWebhook {
  provider: 'github';
  deliveryId: string;
  event: string;
  action: string | null;
  installationId: string | null;
  payload: Record<string, unknown>;
}

/**
 * Webhook deliveries. Recording one has no tenant context (the organization follows from the
 * installation), so it goes through forgeflow_record_webhook_delivery(), which stores the
 * delivery and its outbox event in one transaction, once per delivery id.
 */
@Injectable()
export class WebhooksService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async record(webhook: IncomingWebhook): Promise<{ id: string; created: boolean }> {
    const result = await this.database.db.execute<{ delivery_id: string; created: boolean }>(
      sql`select * from forgeflow_record_webhook_delivery(
        ${webhook.provider}, ${webhook.deliveryId}, ${webhook.event}, ${webhook.action},
        ${webhook.installationId}, ${JSON.stringify(webhook.payload)}::jsonb)`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('Recording the webhook delivery returned no row');
    return { id: row.delivery_id, created: row.created };
  }

  /** The latest deliveries for an integration of the organization, with how their handling went. */
  async listForIntegration(
    organizationId: string,
    integrationId: string,
    limit = 20,
  ): Promise<WebhookDelivery[]> {
    const rows = await this.database.withTenant({ organizationId }, (tx) =>
      tx
        .select({ delivery: webhookDeliveries, event: outboxEvents })
        .from(webhookDeliveries)
        .leftJoin(outboxEvents, eq(outboxEvents.id, webhookDeliveries.outboxEventId))
        .where(
          and(
            eq(webhookDeliveries.organizationId, organizationId),
            eq(webhookDeliveries.integrationId, integrationId),
          ),
        )
        .orderBy(desc(webhookDeliveries.receivedAt))
        .limit(limit),
    );
    return rows.map(({ delivery, event }) => ({
      id: delivery.id,
      deliveryId: delivery.deliveryId,
      event: delivery.event,
      action: delivery.action,
      receivedAt: delivery.receivedAt.toISOString(),
      status: event?.status ?? null,
      attempts: event?.attempts ?? 0,
      lastError: event?.lastError ?? null,
    }));
  }
}
