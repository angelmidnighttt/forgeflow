import { randomUUID } from 'node:crypto';
import { users, type Database, type NewUser, type User } from '@forgeflow/database';

/**
 * URL of the integration test database. global-setup.ts chooses it, recreates the database,
 * applies migrations and exports it as TEST_DATABASE_URL before any test file runs.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Run integration tests through Jest (npm test) so global-setup.ts prepares the database.',
    );
  }
  return url;
}

/** Inserts a user with a unique email. Tests never share rows, so they can run in parallel. */
export async function createUser(db: Database, overrides: Partial<NewUser> = {}): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({ email: `user-${randomUUID()}@example.test`, name: 'Test User', ...overrides })
    .returning();
  if (!user) throw new Error('User insert returned no row');
  return user;
}

/** PostgreSQL error code of a failed query, whether or not Drizzle wrapped the driver error. */
export function pgErrorCode(error: unknown): string | undefined {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | undefined;
  const code = candidate?.code ?? candidate?.cause?.code;
  return typeof code === 'string' ? code : undefined;
}
