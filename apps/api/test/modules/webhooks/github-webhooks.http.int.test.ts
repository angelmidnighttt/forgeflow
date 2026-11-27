import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  createDatabase,
  outboxEvents,
  webhookDeliveries,
  type DatabaseHandle,
} from '@forgeflow/database';
import { eq } from 'drizzle-orm';
import { createApp } from '../../../src/app.factory.js';
import { githubSignature } from '../../../src/common/utils/webhook-signature.util.js';
import { IntegrationsService } from '../../../src/modules/integrations/integrations.service.js';
import { envFor } from '../../support/http.js';
import { githubAppEnv, sendGithubWebhook } from '../../support/github-app.js';
import { createOrganization, verifiedUser } from '../../support/organizations.js';
import { testOwnerDatabaseUrl } from '../../support/test-database.js';

let database: DatabaseHandle;
let app: INestApplication;

beforeAll(async () => {
  database = createDatabase(testOwnerDatabaseUrl(), { max: 2 });
  app = await createApp(envFor(githubAppEnv()));
  await app.init();
});

afterAll(async () => {
  await app.close();
  await database.close();
});

const ping = (installationId?: number) => ({
  zen: 'Keep it logically awesome.',
  hook_id: 1,
  ...(installationId ? { installation: { id: installationId } } : {}),
});

async function deliveriesWith(deliveryId: string) {
  return database.db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.deliveryId, deliveryId));
}

describe('POST /api/v1/webhooks/github', () => {
  it('records a delivery with its outbox event and answers 202 at once', async () => {
    const delivery = randomUUID();
    const res = await sendGithubWebhook(app, { event: 'ping', delivery, body: ping() }).expect(202);
    expect(res.body.data).toMatchObject({ duplicate: false });

    const [row] = await deliveriesWith(delivery);
    expect(row).toMatchObject({ provider: 'github', event: 'ping', organizationId: null });
    const [event] = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, row!.outboxEventId!));
    expect(event).toMatchObject({ topic: 'github.webhook', organizationId: null });
    expect(event!.payload).toMatchObject({ deliveryId: row!.id, event: 'ping', body: ping() });
  });

  it('keeps one record of a delivery sent 3 times, and of one sent 10 times at once (required test #1)', async () => {
    const thrice = randomUUID();
    const answers = [];
    for (let i = 0; i < 3; i++) {
      answers.push(
        (
          await sendGithubWebhook(app, { event: 'ping', delivery: thrice, body: ping() }).expect(
            202,
          )
        ).body.data,
      );
    }
    expect(answers.map((a) => a.duplicate)).toEqual([false, true, true]);
    expect(new Set(answers.map((a) => a.id)).size).toBe(1);
    expect(await deliveriesWith(thrice)).toHaveLength(1);

    const tenTimes = randomUUID();
    const concurrent = await Promise.all(
      Array.from({ length: 10 }, () =>
        sendGithubWebhook(app, { event: 'ping', delivery: tenTimes, body: ping() }),
      ),
    );
    expect(concurrent.map((r) => r.status)).toEqual(Array<number>(10).fill(202));
    expect(concurrent.filter((r) => r.body.data.duplicate === false)).toHaveLength(1);
    const rows = await deliveriesWith(tenTimes);
    expect(rows).toHaveLength(1);
    const events = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, rows[0]!.outboxEventId!));
    expect(events).toHaveLength(1);
  });

  it('refuses a wrong or missing signature with 401 and records nothing', async () => {
    const body = ping();
    const cases = [
      { signature: null },
      { signature: 'sha256=00' },
      { signature: githubSignature('another-secret-0123456789', JSON.stringify(body)) },
      { signature: githubSignature('test-only-webhook-secret-0123456789', '{"zen":"other"}') },
      { signature: 'sha1=abc' },
    ];
    for (const { signature } of cases) {
      const delivery = randomUUID();
      const res = await sendGithubWebhook(app, { event: 'ping', delivery, body, signature }).expect(
        401,
      );
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
      expect(await deliveriesWith(delivery)).toEqual([]);
    }
  });

  it('refuses a request without delivery or event headers', async () => {
    const res = await sendGithubWebhook(app, {
      event: 'Not An Event!',
      body: ping(),
    }).expect(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it("files a delivery under the organization of the installation's integration", async () => {
    const owner = await verifiedUser(app, database);
    const organization = await createOrganization(app, owner);
    const installationId = Math.floor(Math.random() * 1e9);
    const { integration } = await app
      .get(IntegrationsService)
      .create(
        organization.id,
        { kind: 'github', name: `GitHub ${installationId}`, externalId: String(installationId) },
        'system',
      );

    const delivery = randomUUID();
    await sendGithubWebhook(app, { event: 'ping', delivery, body: ping(installationId) }).expect(
      202,
    );
    const [row] = await deliveriesWith(delivery);
    expect(row).toMatchObject({
      installationId: String(installationId),
      organizationId: organization.id,
      integrationId: integration.id,
    });
    const [event] = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, row!.outboxEventId!));
    expect(event!.organizationId).toBe(organization.id);
  });

  it('answers 404 when the GitHub App is not configured', async () => {
    const plain = await createApp(envFor());
    await plain.init();
    try {
      await sendGithubWebhook(plain, { event: 'ping', body: ping() }).expect(404);
    } finally {
      await plain.close();
    }
  });
});
