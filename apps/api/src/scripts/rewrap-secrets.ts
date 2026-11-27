// Moves every integration secret's data key under the current KEK of SECRET_ENCRYPTION_KEYS
// (the highest version), as the owner of the tables (MIGRATION_DATABASE_URL). Safe to run again.
//
// Rotating the KEK: add the new key with a higher version in front of the old one
// ("2:<new>,1:<old>"), deploy, run this, then remove the old key and deploy again.
import { loadDotEnv, parseEnv } from '@forgeflow/config';
import { createDatabase, migrationEnvSchema } from '@forgeflow/database';
import { rewrapSecrets } from '../common/utils/secret-rewrap.util.js';
import { secretEncryptionKeysSchema } from '../config/env.js';

loadDotEnv();
const env = parseEnv(
  migrationEnvSchema.extend({ SECRET_ENCRYPTION_KEYS: secretEncryptionKeysSchema }),
);
const database = createDatabase(env.MIGRATION_DATABASE_URL, { max: 1 });
try {
  const count = await rewrapSecrets(database, env.SECRET_ENCRYPTION_KEYS);
  console.log(
    `Rewrapped ${count} secret(s); all now use key ${env.SECRET_ENCRYPTION_KEYS.current}.`,
  );
} finally {
  await database.close();
}
