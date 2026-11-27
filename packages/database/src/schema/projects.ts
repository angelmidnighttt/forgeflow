import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamptz } from './columns.js';
import { organizations } from './tenancy.js';

/**
 * A project: one application or service an organization ships (later: its repositories,
 * deployments, incidents). Names are unique in an organization, ignoring case.
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('projects_organization_name_key').on(t.organizationId, sql`lower(${t.name})`),
    // Target of the composite foreign keys of the project's children (docs/adr/ADR-0002).
    unique('projects_organization_id_key').on(t.organizationId, t.id),
  ],
);

/**
 * Where a project runs: development, staging, production, or any other the organization adds.
 * A protected environment needs approval before ForgeFlow changes it (Phase 6).
 *
 * The foreign key to the project includes organization_id, so an environment can never belong
 * to a project of another organization, whatever the application does.
 */
export const environments = pgTable(
  'environments',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid().notNull(),
    projectId: uuid().notNull(),
    name: text().notNull(),
    protected: boolean().notNull().default(false),
    /** Display order in the project, from development to production; new ones go last. */
    position: integer().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    foreignKey({
      name: 'environments_project_fkey',
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete('cascade'),
    uniqueIndex('environments_project_name_key').on(t.projectId, sql`lower(${t.name})`),
    index('environments_organization_id_idx').on(t.organizationId),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type EnvironmentRow = typeof environments.$inferSelect;
