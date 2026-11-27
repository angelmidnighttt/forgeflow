import {
  integrationSecrets,
  roleBypassesRowLevelSecurity,
  type DatabaseHandle,
} from '@forgeflow/database';
import { and, asc, eq, ne } from 'drizzle-orm';
import type { Keyring } from '../types/secrets.types.js';
import { rewrap, secretContext } from './envelope.util.js';

/**
 * Rewraps the data key of every integration secret that is not under the keyring's current KEK
 * yet (KEK rotation): the ciphertexts stay as they are. Returns how many were rewrapped.
 *
 * Runs across all organizations, so `database` must connect as the owner of the tables: the
 * api's role sees no secret without a tenant context, and may not change these columns.
 */
export async function rewrapSecrets(
  database: DatabaseHandle,
  keyring: Keyring,
  batchSize = 200,
): Promise<number> {
  if (!(await roleBypassesRowLevelSecurity(database.pool))) {
    throw new Error(
      'Rewrapping secrets needs the owner of the tables (MIGRATION_DATABASE_URL), not the api role',
    );
  }
  let rewrapped = 0;
  for (;;) {
    const rows = await database.db
      .select()
      .from(integrationSecrets)
      .where(ne(integrationSecrets.kekVersion, keyring.current))
      .orderBy(asc(integrationSecrets.id))
      .limit(batchSize);
    if (rows.length === 0) return rewrapped;
    for (const row of rows) {
      const sealed = rewrap(keyring, row, secretContext(row));
      // Only if nobody rewrapped it meanwhile.
      await database.db
        .update(integrationSecrets)
        .set({ kekVersion: sealed.kekVersion, wrappedKey: sealed.wrappedKey })
        .where(
          and(eq(integrationSecrets.id, row.id), eq(integrationSecrets.kekVersion, row.kekVersion)),
        );
      rewrapped += 1;
    }
  }
}
