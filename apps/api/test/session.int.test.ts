import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createDatabase, sessions, users, type DatabaseHandle } from '@forgeflow/database';
import { eq } from 'drizzle-orm';
import { SESSION_POLICY } from '../src/identity/session.policy.js';
import { hashSessionToken, SessionService } from '../src/identity/session.service.js';
import { createUser, pgErrorCode, testDatabaseUrl } from './support/test-database.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const T0 = new Date('2026-01-01T00:00:00.000Z');

let database: DatabaseHandle;
let now: Date;
let service: SessionService;

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { max: 4 });
  service = new SessionService(database, () => now);
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

async function issue() {
  const user = await createUser(database.db);
  const issued = await service.create(user.id, { userAgent: 'jest', ipAddress: '127.0.0.1' });
  return { user, ...issued };
}

async function storedSession(id: string) {
  const [row] = await database.db.select().from(sessions).where(eq(sessions.id, id));
  return row;
}

describe('SessionService', () => {
  it('stores only the SHA-256 hash of the token', async () => {
    const { token, session } = await issue();
    const row = await storedSession(session.id);

    expect(row?.tokenHash).toBe(hashSessionToken(token));
    expect(row?.tokenHash).not.toContain(token);
    expect(row?.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row?.csrfToken).not.toBe(token);
  });

  it('starts with a 7-day idle expiry and a 30-day absolute expiry', async () => {
    const { session } = await issue();
    expect(session.expiresAt).toEqual(at(SESSION_POLICY.idleTimeoutMs));
    expect(session.absoluteExpiresAt).toEqual(at(SESSION_POLICY.absoluteLifetimeMs));
  });

  it('returns the user for a valid token', async () => {
    const { user, token, session } = await issue();
    const auth = await service.validate(token);

    expect(auth?.user).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerifiedAt: null,
    });
    expect(auth?.session.id).toBe(session.id);
  });

  it('returns null for unknown and malformed tokens', async () => {
    await expect(service.validate(randomBytes(32).toString('base64url'))).resolves.toBeNull();
    await expect(service.validate('not-a-token')).resolves.toBeNull();
    await expect(service.validate('')).resolves.toBeNull();
  });

  it('does not write to the database when used again within the touch interval', async () => {
    const { token, session } = await issue();
    now = at(30 * 60 * 1000);
    await service.validate(token);

    const row = await storedSession(session.id);
    expect(row?.lastUsedAt).toEqual(T0);
    expect(row?.expiresAt).toEqual(session.expiresAt);
  });

  it('moves the idle expiry forward when used after the touch interval', async () => {
    const { token, session } = await issue();
    now = at(2 * HOUR_MS);
    const auth = await service.validate(token);

    const row = await storedSession(session.id);
    expect(row?.lastUsedAt).toEqual(now);
    expect(row?.expiresAt).toEqual(new Date(now.getTime() + SESSION_POLICY.idleTimeoutMs));
    expect(auth?.session.expiresAt).toEqual(row?.expiresAt);
  });

  it('rejects and deletes a session left idle past the timeout', async () => {
    const { token, session } = await issue();
    now = at(SESSION_POLICY.idleTimeoutMs + 1000);

    await expect(service.validate(token)).resolves.toBeNull();
    await expect(storedSession(session.id)).resolves.toBeUndefined();
  });

  it('ends a session at its absolute lifetime even when it is used every day', async () => {
    const { token } = await issue();
    for (let day = 1; day < 30; day++) {
      now = at(day * DAY_MS);
      await expect(service.validate(token)).resolves.not.toBeNull();
    }
    now = at(SESSION_POLICY.absoluteLifetimeMs);
    await expect(service.validate(token)).resolves.toBeNull();
  });

  it('revoke deletes the session so its token stops working', async () => {
    const { token, session } = await issue();
    await service.revoke(session.id);

    await expect(storedSession(session.id)).resolves.toBeUndefined();
    await expect(service.validate(token)).resolves.toBeNull();
  });
});

describe('users table', () => {
  it('rejects a second account whose email differs only in letter case', async () => {
    const email = `Case-${randomUUID()}@Example.test`;
    await createUser(database.db, { email });

    const error = await createUser(database.db, { email: email.toLowerCase() }).catch(
      (e: unknown) => e,
    );
    expect(pgErrorCode(error)).toBe('23505');
  });

  it('deletes a user’s sessions when the user is deleted', async () => {
    const { user, session } = await issue();
    await database.db.delete(users).where(eq(users.id, user.id));

    await expect(storedSession(session.id)).resolves.toBeUndefined();
  });
});
