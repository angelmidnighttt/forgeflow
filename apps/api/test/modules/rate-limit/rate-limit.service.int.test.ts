import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createDatabase, type DatabaseHandle } from '@forgeflow/database';
import type { RateLimitRule } from '../../../src/common/types/rate-limit.types.js';
import { RateLimitService } from '../../../src/modules/rate-limit/rate-limit.service.js';
import { testOwnerDatabaseUrl } from '../../support/test-database.js';

const T0 = new Date('2026-01-01T00:00:00.000Z');
const RULE: RateLimitRule = { name: 'test', limit: 3, windowMs: 60_000, by: 'custom' };

let database: DatabaseHandle;
let now: Date;
let service: RateLimitService;

beforeAll(() => {
  database = createDatabase(testOwnerDatabaseUrl(), { max: 8 });
  service = new RateLimitService(database, () => now);
});

afterAll(async () => {
  await database.close();
});

beforeEach(() => {
  now = T0;
});

const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

describe('RateLimitService', () => {
  it('allows up to the limit in one window and says when it ends', async () => {
    const subject = randomUUID();
    for (const hits of [1, 2, 3]) {
      await expect(service.hit(RULE, subject)).resolves.toEqual({
        allowed: true,
        hits,
        retryAfterSeconds: 60,
      });
    }
    now = at(15_000);
    await expect(service.hit(RULE, subject)).resolves.toEqual({
      allowed: false,
      hits: 4,
      retryAfterSeconds: 45,
    });
  });

  it('starts over once the window has ended', async () => {
    const subject = randomUUID();
    for (let i = 0; i < 5; i++) await service.hit(RULE, subject);

    now = at(60_000);
    await expect(service.hit(RULE, subject)).resolves.toEqual({
      allowed: true,
      hits: 1,
      retryAfterSeconds: 60,
    });
  });

  it('keeps subjects and rules apart', async () => {
    const subject = randomUUID();
    for (let i = 0; i < 4; i++) await service.hit(RULE, subject);

    await expect(service.hit(RULE, randomUUID())).resolves.toMatchObject({ allowed: true });
    await expect(service.hit({ ...RULE, name: 'other' }, subject)).resolves.toMatchObject({
      allowed: true,
      hits: 1,
    });
  });

  it('reset() starts the count over', async () => {
    const subject = randomUUID();
    for (let i = 0; i < 4; i++) await service.hit(RULE, subject);
    await service.reset(RULE, subject);
    await expect(service.hit(RULE, subject)).resolves.toMatchObject({ allowed: true, hits: 1 });
  });

  it('counts every one of many concurrent hits', async () => {
    const subject = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => service.hit({ ...RULE, limit: 5 }, subject)),
    );

    expect(results.map((r) => r.hits).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});
