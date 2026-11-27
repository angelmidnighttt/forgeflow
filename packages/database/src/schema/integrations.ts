import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, sqlList, timestamptz } from './columns.js';
import { users } from './identity.js';
import { projects } from './projects.js';
import { organizations } from './tenancy.js';

export const INTEGRATION_STATUSES = ['active', 'disabled'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/** Who made a secret's value: ForgeFlow (random, shown once) or the user (their credential). */
export const SECRET_SOURCES = ['generated', 'provided'] as const;
export type SecretSource = (typeof SECRET_SOURCES)[number];

/**
 * A connection of an organization to an outside system: a GitHub App installation, an
 * Alertmanager, a Prometheus… (`kind`), optionally for one project. `config` holds its settings
 * that are not secret; secrets live in integration_secrets, encrypted.
 */
export const integrations = pgTable(
  'integrations',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Null for an integration of the whole organization (a GitHub installation). */
    projectId: uuid(),
    kind: text().notNull(),
    name: text().notNull(),
    status: text().$type<IntegrationStatus>().notNull().default('active'),
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** The outside system's id for it (a GitHub installation id); unique per kind. */
    externalId: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // With project_id null the key is not checked (MATCH SIMPLE): an organization-wide one.
    foreignKey({
      name: 'integrations_project_fkey',
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete('cascade'),
    unique('integrations_organization_id_key').on(t.organizationId, t.id),
    uniqueIndex('integrations_organization_name_key').on(t.organizationId, sql`lower(${t.name})`),
    uniqueIndex('integrations_kind_external_id_key')
      .on(t.kind, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    check('integrations_status_check', sql`${t.status} IN (${sqlList(INTEGRATION_STATUSES)})`),
  ],
);

/**
 * The secrets of an integration, by name, under envelope encryption: each version's value is
 * encrypted with its own data key, which is encrypted ("wrapped") with the key-encryption key
 * `kek_version` of SECRET_ENCRYPTION_KEYS. Rotating adds a version and revokes the previous one,
 * so at most one version per name is usable. The api may set revoked_at and nothing else
 * (migration 0014): a stored ciphertext is never overwritten.
 */
export const integrationSecrets = pgTable(
  'integration_secrets',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid().notNull(),
    integrationId: uuid().notNull(),
    name: text().notNull(),
    version: integer().notNull(),
    source: text().$type<SecretSource>().notNull(),
    kekVersion: integer().notNull(),
    /** The data key, encrypted with the KEK: nonce | tag | ciphertext. */
    wrappedKey: bytea().notNull(),
    /** The value, encrypted with the data key: nonce | tag | ciphertext. */
    ciphertext: bytea().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamptz().notNull().defaultNow(),
    revokedAt: timestamptz(),
  },
  (t) => [
    foreignKey({
      name: 'integration_secrets_integration_fkey',
      columns: [t.organizationId, t.integrationId],
      foreignColumns: [integrations.organizationId, integrations.id],
    }).onDelete('cascade'),
    uniqueIndex('integration_secrets_version_key').on(t.integrationId, t.name, t.version),
    uniqueIndex('integration_secrets_usable_key')
      .on(t.integrationId, t.name)
      .where(sql`${t.revokedAt} IS NULL`),
    check('integration_secrets_name_check', sql`${t.name} ~ '^[a-z][a-z0-9_]{0,62}$'`),
    check('integration_secrets_version_check', sql`${t.version} >= 1`),
    check('integration_secrets_source_check', sql`${t.source} IN (${sqlList(SECRET_SOURCES)})`),
  ],
);

export type IntegrationRow = typeof integrations.$inferSelect;
export type IntegrationSecretRow = typeof integrationSecrets.$inferSelect;
