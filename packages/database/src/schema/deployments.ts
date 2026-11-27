import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sqlList, timestamptz } from './columns.js';
import { environments, projects } from './projects.js';

/** One vocabulary for every source (GitHub deployments and Actions runs, the report API). */
export const DEPLOYMENT_STATUSES = [
  'queued',
  'in_progress',
  'success',
  'failure',
  'error',
  'cancelled',
  'inactive',
] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

/** Where a deployment was learned from: the GitHub App, or a pipeline through the report API. */
export const DEPLOYMENT_SOURCES = ['github', 'api'] as const;
export type DeploymentSource = (typeof DEPLOYMENT_SOURCES)[number];

/** A deployment proper, or a CI run (GitHub Actions) that targets no environment. */
export const DEPLOYMENT_KINDS = ['deployment', 'workflow_run'] as const;
export type DeploymentKind = (typeof DEPLOYMENT_KINDS)[number];

/**
 * What a project shipped where: one row per deployment (or Actions run), whose status follows the
 * newest event received (status_at), so events that arrive out of order cannot set it back.
 * A source's own id (external_id) is unique per project, which makes every write idempotent.
 */
export const deployments = pgTable(
  'deployments',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid().notNull(),
    projectId: uuid().notNull(),
    /** Null for a CI run that deploys nowhere. */
    environmentId: uuid(),
    source: text().$type<DeploymentSource>().notNull(),
    kind: text().$type<DeploymentKind>().notNull(),
    /** The source's id: a GitHub deployment or run id, a report API Idempotency-Key. */
    externalId: text().notNull(),
    /** owner/name, for GitHub sources. */
    repository: text(),
    /** The environment name as the source gave it. */
    environmentName: text(),
    ref: text(),
    sha: text(),
    version: text(),
    status: text().$type<DeploymentStatus>().notNull(),
    /** When the source reported the current status. */
    statusAt: timestamptz().notNull(),
    description: text(),
    /** Logs or run page. */
    url: text(),
    /** Where the deployed version answers. */
    environmentUrl: text(),
    /** Who deployed: a GitHub login, or the name a pipeline gave. */
    creator: text(),
    /** The Actions workflow's name, for runs. */
    workflow: text(),
    startedAt: timestamptz(),
    finishedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    foreignKey({
      name: 'deployments_project_fkey',
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'deployments_environment_fkey',
      columns: [t.organizationId, t.environmentId],
      foreignColumns: [environments.organizationId, environments.id],
    }).onDelete('cascade'),
    unique('deployments_organization_id_key').on(t.organizationId, t.id),
    uniqueIndex('deployments_source_key').on(t.projectId, t.source, t.kind, t.externalId),
    index('deployments_project_created_idx').on(t.projectId, t.createdAt.desc(), t.id.desc()),
    check('deployments_status_check', sql`${t.status} IN (${sqlList(DEPLOYMENT_STATUSES)})`),
    check('deployments_source_check', sql`${t.source} IN (${sqlList(DEPLOYMENT_SOURCES)})`),
    check('deployments_kind_check', sql`${t.kind} IN (${sqlList(DEPLOYMENT_KINDS)})`),
  ],
);

/** The status history of a deployment; a source's event id appears once (idempotent). */
export const deploymentEvents = pgTable(
  'deployment_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid().notNull(),
    deploymentId: uuid().notNull(),
    status: text().$type<DeploymentStatus>().notNull(),
    description: text(),
    /** A GitHub deployment status id; the status itself for Actions runs and the report API. */
    externalId: text(),
    occurredAt: timestamptz().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'deployment_events_deployment_fkey',
      columns: [t.organizationId, t.deploymentId],
      foreignColumns: [deployments.organizationId, deployments.id],
    }).onDelete('cascade'),
    uniqueIndex('deployment_events_external_key')
      .on(t.deploymentId, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    index('deployment_events_deployment_idx').on(t.deploymentId, t.occurredAt),
    check('deployment_events_status_check', sql`${t.status} IN (${sqlList(DEPLOYMENT_STATUSES)})`),
  ],
);

export type DeploymentRow = typeof deployments.$inferSelect;
export type DeploymentEventRow = typeof deploymentEvents.$inferSelect;
