import { randomUUID } from 'node:crypto';
import { users, type Database, type NewUser, type User } from '@forgeflow/database';

function preparedUrl(variable: 'TEST_DATABASE_URL' | 'TEST_MIGRATION_DATABASE_URL'): string {
  const url = process.env[variable];
  if (!url) {
    throw new Error(
      `${variable} is not set. Run integration tests through Jest (npm test) so global-setup.ts prepares the database.`,
    );
  }
  return url;
}

/**
 * The test database as the api sees it: the forgeflow_app role, which row-level security
 * applies to. Use it for the app under test and for RLS tests.
 */
export function testDatabaseUrl(): string {
  return preparedUrl('TEST_DATABASE_URL');
}

/**
 * The test database as its owner, which bypasses row-level security. Use it for fixtures that
 * write rows directly and for assertions that read them back.
 */
export function testOwnerDatabaseUrl(): string {
  return preparedUrl('TEST_MIGRATION_DATABASE_URL');
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
