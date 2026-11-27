import { randomUUID } from 'node:crypto';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { auditLogPageSchema, outboxEventSchema } from '@forgeflow/contracts';
import {
  createDatabase,
  outboxEvents,
  webhookDeliveries,
  type DatabaseHandle,
} from '@forgeflow/database';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from '../../../src/app.factory.js';
import type { OutboxHandler } from '../../../src/common/types/outbox.types.js';
import { outboxBackoffMs, PermanentOutboxError } from '../../../src/common/utils/outbox.util.js';
import {
  OutboxProcessor,
  OutboxWorkerService,
} from '../../../src/modules/outbox/outbox-worker.service.js';
import { OutboxService } from '../../../src/modules/outbox/outbox.service.js';
import { WorkerModule } from '../../../src/worker.module.js';
import { bearer, client, envFor, registerUser } from '../../support/http.js';
import { githubAppEnv, sendGithubWebhook } from '../../support/github-app.js';
import { addMember, createOrganization, verifiedUser } from '../../support/organizations.js';
import { testOwnerDatabaseUrl } from '../../support/test-database.js';

let database: DatabaseHandle;
let app: INestApplication;
let outbox: OutboxService;

beforeAll(async () => {
  database = createDatabase(testOwnerDatabaseUrl(), { max: 3 });
  app = await createApp(envFor(githubAppEnv()));
  await app.init();
  outbox = app.get(OutboxService);
});

afterAll(async () => {
  await app.close();
  await database.close();
});

const quiet = { warn: () => undefined, error: () => undefined };
/** A topic of its own per test: no other test (nor the worker test) ever claims its events. */
const newTopic = () => `test.${randomUUID()}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function addEvents(topic: string, count: number, organizationId: string | null = null) {
  return database.db
    .insert(outboxEvents)
    .values(Array.from({ length: count }, (_, i) => ({ topic, organizationId, payload: { i } })))
    .returning();
}

async function eventsOf(topic: string) {
  return database.db.select().from(outboxEvents).where(eq(outboxEvents.topic, topic));
}

function processor(
  topic: string,
  handler: OutboxHandler,
  maxAttempts = 5,
  lease: { leaseSeconds: number; maxHoldSeconds: number } = {
    leaseSeconds: 30,
    maxHoldSeconds: 600,
  },
) {
  return new OutboxProcessor(
    outbox,
    new Map([[topic, handler]]),
    { batchSize: 4, maxAttempts, ...lease },
    quiet,
  );
}

async function drain(worker: OutboxProcessor) {
  while ((await worker.runOnce()) > 0) {
    // keep going
  }
}

describe('the outbox processor', () => {
  it('handles every event once, even with two workers at the same time', async () => {
    const topic = newTopic();
    await addEvents(topic, 30);
    const seen = new Map<string, number>();
    const handler: OutboxHandler = async (event) => {
      seen.set(event.id, (seen.get(event.id) ?? 0) + 1);
      await sleep(2);
    };
    await Promise.all([drain(processor(topic, handler)), drain(processor(topic, handler))]);

    expect(seen.size).toBe(30);
    expect([...seen.values()].every((count) => count === 1)).toBe(true);
    const rows = await eventsOf(topic);
    expect(rows.every((row) => row.status === 'done' && row.processedAt !== null)).toBe(true);
  });

  it('retries a failed event after a backoff, then completes it', async () => {
    const topic = newTopic();
    const [event] = await addEvents(topic, 1);
    let calls = 0;
    const worker = processor(topic, async () => {
      calls += 1;
      if (calls === 1) throw new Error('the other system is down');
    });

    const before = Date.now();
    expect(await worker.runOnce()).toBe(1);
    const [failed] = await eventsOf(topic);
    expect(failed).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'the other system is down',
      lockToken: null,
    });
    expect(failed!.availableAt.getTime()).toBeGreaterThanOrEqual(before + 8_000);
    // Not due yet: nothing to claim.
    expect(await worker.runOnce()).toBe(0);

    await database.db
      .update(outboxEvents)
      .set({ availableAt: sql`clock_timestamp()` })
      .where(eq(outboxEvents.id, event!.id));
    expect(await worker.runOnce()).toBe(1);
    const [done] = await eventsOf(topic);
    expect(done).toMatchObject({ status: 'done', attempts: 2, lastError: null });
  });

  it('gives an event up as dead after the last attempt, or at once when it can never succeed', async () => {
    const topic = newTopic();
    await addEvents(topic, 1);
    const worker = processor(topic, async () => Promise.reject(new Error('still down')), 2);
    await worker.runOnce();
    await database.db
      .update(outboxEvents)
      .set({ availableAt: sql`clock_timestamp()` })
      .where(eq(outboxEvents.topic, topic));
    await worker.runOnce();
    expect(await eventsOf(topic)).toEqual([
      expect.objectContaining({ status: 'dead', attempts: 2, lastError: 'still down' }),
    ]);

    const permanent = newTopic();
    await addEvents(permanent, 1);
    await processor(permanent, async () =>
      Promise.reject(new PermanentOutboxError('malformed payload')),
    ).runOnce();
    expect(await eventsOf(permanent)).toEqual([
      expect.objectContaining({ status: 'dead', attempts: 1, lastError: 'malformed payload' }),
    ]);
  });

  it('lets another worker take over an expired claim, after which the first cannot finish it', async () => {
    const topic = newTopic();
    await addEvents(topic, 1);
    const [first] = await outbox.claim([topic], 1, 30);
    expect(await outbox.claim([topic], 1, 30)).toEqual([]);

    // The first worker stalls past its lease.
    await database.db
      .update(outboxEvents)
      .set({ lockedUntil: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(outboxEvents.topic, topic));
    const [second] = await outbox.claim([topic], 1, 30);
    expect(second).toMatchObject({ id: first!.id, attempts: 2 });
    expect(second!.lockToken).not.toBe(first!.lockToken);

    expect(await outbox.complete(first!)).toBe(false);
    expect(await outbox.fail(first!, 'late', null)).toBe(false);
    expect(await outbox.complete(second!)).toBe(true);
    expect(await eventsOf(topic)).toEqual([expect.objectContaining({ status: 'done' })]);
  });

  it('keeps the claims of the batch in hand while a slow event is handled', async () => {
    const topic = newTopic();
    await addEvents(topic, 2);
    const handled: string[] = [];
    const slow = processor(
      topic,
      async (event) => {
        handled.push(event.id);
        if (handled.length === 1) await sleep(2_500);
      },
      5,
      { leaseSeconds: 1, maxHoldSeconds: 60 },
    );
    const running = slow.runOnce();
    await sleep(1_800);
    // Both leases (1 s) would have run out by now without renewal.
    const other = processor(topic, async () => undefined);
    expect(await other.runOnce()).toBe(0);
    expect(await running).toBe(2);

    const rows = await eventsOf(topic);
    expect(rows.map((row) => [row.status, row.attempts])).toEqual([
      ['done', 1],
      ['done', 1],
    ]);
  });

  it('lets a batch held past maxHoldSeconds go to another worker', async () => {
    const topic = newTopic();
    const [event] = await addEvents(topic, 1);
    const hung = processor(topic, async () => void (await sleep(3_500)), 5, {
      leaseSeconds: 1,
      maxHoldSeconds: 1,
    });
    const running = hung.runOnce();
    await sleep(2_500);
    const other = processor(topic, async () => undefined);
    expect(await other.runOnce()).toBe(1);
    await running;

    // The takeover completed it; the hung worker's late completion changed nothing.
    const [row] = await eventsOf(topic);
    expect(row?.id).toBe(event?.id);
    expect(row?.status).toBe('done');
    expect(row?.attempts).toBe(2);
  });

  it('claims only the topics it is asked for', async () => {
    const mine = newTopic();
    const other = newTopic();
    await addEvents(other, 2);
    expect(await outbox.claim([mine], 10, 30)).toEqual([]);
    expect(await eventsOf(other)).toEqual([
      expect.objectContaining({ status: 'pending' }),
      expect.objectContaining({ status: 'pending' }),
    ]);
  });

  it('waits 10 s, 20 s, 40 s… up to an hour between attempts', () => {
    const middle = () => 0.5;
    expect([1, 2, 3, 4].map((a) => outboxBackoffMs(a, middle))).toEqual([
      10_000, 20_000, 40_000, 80_000,
    ]);
    expect(outboxBackoffMs(30, middle)).toBe(3_600_000);
  });
});

describe('the worker process', () => {
  let worker: INestApplicationContext;

  beforeAll(async () => {
    worker = await NestFactory.createApplicationContext(
      WorkerModule.forRoot(envFor(githubAppEnv())),
      { logger: false },
    );
    await worker.get(OutboxWorkerService).start();
    // Let it finish its first pass and go to sleep.
    await sleep(500);
  });

  afterAll(async () => {
    await worker.close();
  });

  it('wakes up on NOTIFY and handles a webhook well before its next poll', async () => {
    const delivery = randomUUID();
    const sent = Date.now();
    await sendGithubWebhook(app, { event: 'ping', delivery, body: { zen: 'hi' } }).expect(202);
    const [row] = await database.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryId, delivery));

    let status: string | undefined;
    while (Date.now() - sent < 4_000) {
      const [event] = await database.db
        .select({ status: outboxEvents.status })
        .from(outboxEvents)
        .where(eq(outboxEvents.id, row!.outboxEventId!));
      status = event?.status;
      if (status === 'done') break;
      await sleep(50);
    }
    expect(status).toBe('done');
    expect(Date.now() - sent).toBeLessThan(4_000);
  });

  it('handles a webhook that came while it was stopped, once it is back', async () => {
    await worker.close();
    const delivery = randomUUID();
    await sendGithubWebhook(app, { event: 'ping', delivery, body: { zen: 'later' } }).expect(202);
    const [row] = await database.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryId, delivery));
    expect(row?.outboxEventId).toEqual(expect.any(String));

    worker = await NestFactory.createApplicationContext(
      WorkerModule.forRoot(envFor(githubAppEnv())),
      { logger: false },
    );
    await worker.get(OutboxWorkerService).start();
    let status: string | undefined;
    for (let tries = 0; tries < 100 && status !== 'done'; tries++) {
      const [event] = await database.db
        .select({ status: outboxEvents.status })
        .from(outboxEvents)
        .where(eq(outboxEvents.id, row!.outboxEventId!));
      status = event?.status;
      if (status !== 'done') await sleep(50);
    }
    expect(status).toBe('done');
  });
});

describe('dead events of an organization', () => {
  it('are listed for owners and admins, and sent back to the queue on request', async () => {
    const owner = await verifiedUser(app, database);
    const organization = await createOrganization(app, owner);
    const member = await registerUser(app);
    await addMember(database, organization.id, member, 'member');
    const topic = newTopic();
    const [dead] = await database.db
      .insert(outboxEvents)
      .values({
        organizationId: organization.id,
        topic,
        payload: { event: 'deployment_status' },
        status: 'dead',
        attempts: 8,
        lastError: 'GitHub said 502',
      })
      .returning();
    const url = `/api/v1/organizations/${organization.id}/events`;

    const list = await client(app)
      .get(`${url}/dead`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(z.array(outboxEventSchema).parse(list.body.data)).toEqual([
      expect.objectContaining({
        id: dead!.id,
        status: 'dead',
        attempts: 8,
        lastError: 'GitHub said 502',
        summary: 'deployment_status',
      }),
    ]);
    await client(app).get(`${url}/dead`).set('Authorization', bearer(member)).expect(403);
    await client(app)
      .post(`${url}/${dead!.id}/retry`)
      .set('Authorization', bearer(member))
      .expect(403);

    await client(app)
      .post(`${url}/${dead!.id}/retry`)
      .set('Authorization', bearer(owner))
      .expect(204);
    expect(await eventsOf(topic)).toEqual([
      expect.objectContaining({ status: 'pending', attempts: 0 }),
    ]);
    // No longer dead.
    await client(app)
      .post(`${url}/${dead!.id}/retry`)
      .set('Authorization', bearer(owner))
      .expect(404);

    const trail = await client(app)
      .get(`/api/v1/organizations/${organization.id}/audit-logs`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(auditLogPageSchema.parse(trail.body.data).entries[0]).toMatchObject({
      action: 'outbox_event.retried',
      target: { type: 'outbox_event', id: dead!.id },
      metadata: { topic },
    });
  });

  it("never shows or retries another organization's events", async () => {
    const a = await verifiedUser(app, database);
    const b = await verifiedUser(app, database);
    const orgA = await createOrganization(app, a);
    const orgB = await createOrganization(app, b);
    const topic = newTopic();
    const [deadB] = await database.db
      .insert(outboxEvents)
      .values({ organizationId: orgB.id, topic, payload: {}, status: 'dead' })
      .returning();

    const list = await client(app)
      .get(`/api/v1/organizations/${orgA.id}/events/dead`)
      .set('Authorization', bearer(a))
      .expect(200);
    expect(list.body.data).toEqual([]);
    await client(app)
      .post(`/api/v1/organizations/${orgA.id}/events/${deadB!.id}/retry`)
      .set('Authorization', bearer(a))
      .expect(404);
    await client(app)
      .post(`/api/v1/organizations/${orgB.id}/events/${deadB!.id}/retry`)
      .set('Authorization', bearer(a))
      .expect(404);
    const [still] = await database.db
      .select()
      .from(outboxEvents)
      .where(inArray(outboxEvents.id, [deadB!.id]));
    expect(still!.status).toBe('dead');
  });
});
