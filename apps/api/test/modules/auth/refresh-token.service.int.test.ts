import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createDatabase, refreshTokens, type DatabaseHandle } from '@forgeflow/database';
import { eq } from 'drizzle-orm';
import { TOKEN_POLICY } from '../../../src/common/constants/auth.constants.js';
import type { IssuedRefreshToken } from '../../../src/common/types/auth.types.js';
import { hashSecretToken } from '../../../src/common/utils/secret-token.util.js';
import { RefreshTokenService } from '../../../src/modules/auth/refresh-token.service.js';
import { createUser, testDatabaseUrl } from '../../support/test-database.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-01-01T00:00:00.000Z');

let database: DatabaseHandle;
let now: Date;
let service: RefreshTokenService;

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { max: 4 });
  service = new RefreshTokenService(database, () => now);
});

afterAll(async () => {
  await database.close();
});

beforeEach(() => {
  now = T0;
});

function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs);
}

async function signIn(client = { userAgent: 'jest', ipAddress: '127.0.0.1' }) {
  const user = await createUser(database.db);
  const issued = await service.create(user.id, client);
  return { user, issued };
}

async function rowsOfFamily(familyId: string) {
  return database.db.select().from(refreshTokens).where(eq(refreshTokens.familyId, familyId));
}

async function rotateOk(secret: string): Promise<IssuedRefreshToken> {
  const result = await service.rotate(secret);
  if (result.status !== 'rotated') throw new Error(`expected rotation, got ${result.status}`);
  return result.issued;
}

describe('RefreshTokenService', () => {
  it('stores only the SHA-256 hash of the secret, with 7-day idle and 30-day limits', async () => {
    const { issued } = await signIn();

    expect(issued.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.token.tokenHash).toBe(hashSecretToken(issued.secret));
    expect(issued.token.tokenHash).not.toContain(issued.secret);
    expect(issued.token.expiresAt).toEqual(at(TOKEN_POLICY.refreshIdleMs));
    expect(issued.token.familyExpiresAt).toEqual(at(TOKEN_POLICY.refreshAbsoluteMs));
    expect(issued.token.revokedAt).toBeNull();
  });

  it('keeps at most 512 characters of the user agent', async () => {
    const { issued } = await signIn({ userAgent: 'x'.repeat(2000), ipAddress: '10.0.0.1' });
    expect(issued.token.userAgent).toHaveLength(512);
    expect(issued.token.ipAddress).toBe('10.0.0.1');
  });

  it('rotates: returns a new token in the same family and retires the old one', async () => {
    const { user, issued } = await signIn();
    now = at(DAY_MS);
    const result = await service.rotate(issued.secret);

    expect(result.status).toBe('rotated');
    if (result.status !== 'rotated') return;
    expect(result.userId).toBe(user.id);
    expect(result.issued.secret).not.toBe(issued.secret);
    expect(result.issued.token.familyId).toBe(issued.token.familyId);
    expect(result.issued.token.expiresAt).toEqual(at(DAY_MS + TOKEN_POLICY.refreshIdleMs));

    const [old] = await database.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, issued.token.id));
    expect(old?.revokedReason).toBe('rotated');
    expect(old?.revokedAt).toEqual(now);
  });

  it('refuses a token left unused past the idle limit', async () => {
    const { issued } = await signIn();
    now = at(TOKEN_POLICY.refreshIdleMs + 1000);
    await expect(service.rotate(issued.secret)).resolves.toEqual({ status: 'invalid' });
  });

  it('ends the sign-in at its absolute limit even when refreshed regularly', async () => {
    const { issued } = await signIn();
    let secret = issued.secret;
    for (let day = 6; day < 30; day += 6) {
      now = at(day * DAY_MS);
      secret = (await rotateOk(secret)).secret;
    }
    now = at(TOKEN_POLICY.refreshAbsoluteMs);
    await expect(service.rotate(secret)).resolves.toEqual({ status: 'invalid' });
  });

  it('revokes the whole family when a replaced token is used again (theft)', async () => {
    const { issued } = await signIn();
    const newer = await rotateOk(issued.secret);

    now = at(TOKEN_POLICY.refreshReuseGraceMs + 1000);
    await expect(service.rotate(issued.secret)).resolves.toEqual({ status: 'reuse_detected' });
    await expect(service.rotate(newer.secret)).resolves.toEqual({ status: 'invalid' });

    const family = await rowsOfFamily(issued.token.familyId);
    expect(family.every((row) => row.revokedAt !== null)).toBe(true);
    expect(family.find((row) => row.id === newer.token.id)?.revokedReason).toBe('reuse_detected');
  });

  it('treats a replaced token used again within the grace window as a race, not theft', async () => {
    const { issued } = await signIn();
    const newer = await rotateOk(issued.secret);

    now = at(TOKEN_POLICY.refreshReuseGraceMs - 1000);
    await expect(service.rotate(issued.secret)).resolves.toEqual({ status: 'conflict' });
    await expect(service.rotate(newer.secret)).resolves.toMatchObject({ status: 'rotated' });
  });

  it('lets only one of two concurrent rotations of the same token succeed', async () => {
    const { issued } = await signIn();
    const results = await Promise.all([
      service.rotate(issued.secret),
      service.rotate(issued.secret),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['conflict', 'rotated']);
    const live = (await rowsOfFamily(issued.token.familyId)).filter((r) => r.revokedAt === null);
    expect(live).toHaveLength(1);
  });

  it('signs out the whole family from any of its tokens', async () => {
    const { issued } = await signIn();
    const newer = await rotateOk(issued.secret);
    await service.revokeBySecret(newer.secret, 'logout');

    await expect(service.rotate(newer.secret)).resolves.toEqual({ status: 'invalid' });
    const family = await rowsOfFamily(issued.token.familyId);
    expect(family.every((row) => row.revokedAt !== null)).toBe(true);
    expect(family.find((row) => row.id === newer.token.id)?.revokedReason).toBe('logout');
  });

  it('returns invalid for unknown and malformed tokens', async () => {
    await expect(service.rotate(randomBytes(32).toString('base64url'))).resolves.toEqual({
      status: 'invalid',
    });
    await expect(service.rotate('not-a-token')).resolves.toEqual({ status: 'invalid' });
  });
});
