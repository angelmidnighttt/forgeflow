import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createDatabase, refreshTokens, users, type DatabaseHandle } from '@forgeflow/database';
import { eq } from 'drizzle-orm';
import { RefreshTokenService } from '../../../src/modules/auth/refresh-token.service.js';
import { toAuthUser, UsersService } from '../../../src/modules/users/users.service.js';
import { createUser, pgErrorCode, testDatabaseUrl } from '../../support/test-database.js';

let database: DatabaseHandle;
let refreshTokenService: RefreshTokenService;

beforeAll(() => {
  database = createDatabase(testDatabaseUrl(), { max: 2 });
  refreshTokenService = new RefreshTokenService(database, () => new Date());
});

afterAll(async () => {
  await database.close();
});

describe('UsersService', () => {
  it('finds a user by id and shows it without the password hash', async () => {
    const created = await createUser(database.db, { passwordHash: 'argon2id$not-a-real-hash' });
    const found = await new UsersService(database).findById(created.id);

    expect(found?.id).toBe(created.id);
    expect(toAuthUser(found!)).toEqual({
      id: created.id,
      email: created.email,
      name: created.name,
      emailVerified: false,
    });
  });

  it('returns undefined for an unknown id', async () => {
    await expect(new UsersService(database).findById(randomUUID())).resolves.toBeUndefined();
  });
});

describe('users and refresh_tokens tables', () => {
  it('reject a second account whose email differs only in letter case', async () => {
    const email = `Case-${randomUUID()}@Example.test`;
    await createUser(database.db, { email });

    const error = await createUser(database.db, { email: email.toLowerCase() }).catch(
      (e: unknown) => e,
    );
    expect(pgErrorCode(error)).toBe('23505');
  });

  it('delete a user’s refresh tokens when the user is deleted', async () => {
    const user = await createUser(database.db);
    const { token } = await refreshTokenService.create(user.id);
    await database.db.delete(users).where(eq(users.id, user.id));

    const rows = await database.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, token.id));
    expect(rows).toHaveLength(0);
  });

  it('reject an unknown revoke reason', async () => {
    const user = await createUser(database.db);
    const { token } = await refreshTokenService.create(user.id);
    const error = await database.db
      .update(refreshTokens)
      // @ts-expect-error -- deliberately outside the allowed set
      .set({ revokedAt: new Date(), revokedReason: 'expired' })
      .where(eq(refreshTokens.id, token.id))
      .catch((e: unknown) => e);
    expect(pgErrorCode(error)).toBe('23514');
  });

  it('reject a revoke time without a reason', async () => {
    const user = await createUser(database.db);
    const { token } = await refreshTokenService.create(user.id);
    const error = await database.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, token.id))
      .catch((e: unknown) => e);
    expect(pgErrorCode(error)).toBe('23514');
  });
});
