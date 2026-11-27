import { Inject, Injectable } from '@nestjs/common';
import type {
  Deployment,
  DeploymentPage,
  DeploymentQuery,
  DeploymentStatus,
} from '@forgeflow/contracts';
import {
  deploymentEvents,
  deployments,
  environments,
  projects,
  type DatabaseHandle,
  type DbExecutor,
  type DeploymentRow,
  type EnvironmentRow,
} from '@forgeflow/database';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DATABASE } from '../../common/constants/injection-tokens.js';
import type {
  GithubDeployment,
  GithubDeploymentStatus,
  GithubWorkflowRun,
} from '../../common/types/github.types.js';
import {
  after,
  decodeCursor,
  encodeCursor,
  preciseTimestamp,
} from '../../common/utils/cursor.util.js';
import {
  FINISHED_STATUSES,
  statusOfGithubState,
  statusOfWorkflowRun,
  versionOf,
} from '../../common/utils/deployment-status.util.js';
import { AuditService } from '../audit/audit.service.js';

/** The project (and repository) a GitHub event's deployment belongs to. */
export interface DeploymentTarget {
  organizationId: string;
  projectId: string;
  repository: string | null;
}

/** A status change to apply to a deployment, from whichever source. */
export interface StatusChange {
  status: DeploymentStatus;
  at: Date;
  externalId: string | null;
  description?: string | null;
  url?: string | null;
  environmentUrl?: string | null;
}

const targetColumns = [
  deployments.projectId,
  deployments.source,
  deployments.kind,
  deployments.externalId,
];

/**
 * Deployments and Actions runs of projects. Every write is idempotent (a source's ids are
 * unique per project; a status event is recorded once) and order-proof: a status applies only
 * if it is not older than the one in place. Writes run inside the caller's tenant transaction.
 */
@Injectable()
export class DeploymentsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * The project's environment called `name` (ignoring case), added when there is none yet, so a
   * deployment to a new environment shows up rather than getting lost.
   */
  async ensureEnvironment(
    tx: DbExecutor,
    organizationId: string,
    projectId: string,
    name: string,
  ): Promise<EnvironmentRow> {
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO environments (organization_id, project_id, name, position)
      SELECT ${organizationId}, ${projectId}, ${name}, coalesce(max(position), -1) + 1
        FROM environments WHERE project_id = ${projectId}
      ON CONFLICT (project_id, lower(name)) DO NOTHING
      RETURNING id`);
    const [environment] = await tx
      .select()
      .from(environments)
      .where(
        and(
          eq(environments.projectId, projectId),
          sql`lower(${environments.name}) = lower(${name})`,
        ),
      );
    if (!environment) throw new Error(`Environment ${name} neither found nor created`);
    if (inserted.rows.length > 0) {
      const [project] = await tx
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, projectId));
      await this.audit.record(tx, {
        organizationId,
        actor: 'system',
        action: 'environment.created',
        target: { type: 'environment', id: environment.id },
        metadata: { project: project?.name ?? null, name, protected: false, reason: 'deployment' },
      });
    }
    return environment;
  }

  /** A GitHub deployment (from a `deployment` webhook, a status, or the catch-up job). */
  async recordGithubDeployment(
    tx: DbExecutor,
    target: DeploymentTarget,
    deployment: GithubDeployment,
  ): Promise<DeploymentRow> {
    const environment = await this.ensureEnvironment(
      tx,
      target.organizationId,
      target.projectId,
      deployment.environment,
    );
    const createdAt = new Date(deployment.created_at);
    const [row] = await tx
      .insert(deployments)
      .values({
        organizationId: target.organizationId,
        projectId: target.projectId,
        environmentId: environment.id,
        source: 'github',
        kind: 'deployment',
        externalId: String(deployment.id),
        repository: target.repository,
        environmentName: deployment.environment,
        ref: deployment.ref,
        sha: deployment.sha,
        version: versionOf(deployment.ref, deployment.sha),
        status: 'queued',
        statusAt: createdAt,
        description: deployment.description ?? null,
        creator: deployment.creator?.login ?? null,
        createdAt,
      })
      .onConflictDoUpdate({
        target: targetColumns,
        set: {
          description: sql`coalesce(excluded.description, ${deployments.description})`,
          creator: sql`coalesce(excluded.creator, ${deployments.creator})`,
        },
      })
      .returning();
    if (!row) throw new Error('Deployment upsert returned no row');
    return row;
  }

  /** The current status of the project's GitHub deployments among `externalIds` that it has. */
  async githubDeploymentStatuses(
    tx: DbExecutor,
    projectId: string,
    externalIds: readonly string[],
  ): Promise<Map<string, DeploymentStatus>> {
    if (externalIds.length === 0) return new Map();
    const rows = await tx
      .select({ externalId: deployments.externalId, status: deployments.status })
      .from(deployments)
      .where(
        and(
          eq(deployments.projectId, projectId),
          eq(deployments.source, 'github'),
          eq(deployments.kind, 'deployment'),
          inArray(deployments.externalId, [...externalIds]),
        ),
      );
    return new Map(rows.map((row) => [row.externalId, row.status]));
  }

  /** A `deployment_status` (webhook or catch-up job): recorded once, applied if newest. */
  async applyGithubDeploymentStatus(
    tx: DbExecutor,
    target: DeploymentTarget,
    deployment: GithubDeployment,
    status: GithubDeploymentStatus,
  ): Promise<void> {
    const row = await this.recordGithubDeployment(tx, target, deployment);
    await this.applyStatus(tx, row, {
      status: statusOfGithubState(status.state),
      at: new Date(status.created_at),
      externalId: String(status.id),
      description: status.description ?? null,
      url: status.log_url ?? status.target_url ?? null,
      environmentUrl: status.environment_url ?? null,
    });
  }

  /** A GitHub Actions run (webhook or catch-up job): a deployment of kind workflow_run. */
  async recordWorkflowRun(
    tx: DbExecutor,
    target: DeploymentTarget,
    run: GithubWorkflowRun,
  ): Promise<void> {
    const status = statusOfWorkflowRun(run.status, run.conclusion);
    const at = new Date(run.updated_at);
    const startedAt = status === 'queued' ? null : new Date(run.run_started_at ?? run.created_at);
    const [row] = await tx
      .insert(deployments)
      .values({
        organizationId: target.organizationId,
        projectId: target.projectId,
        environmentId: null,
        source: 'github',
        kind: 'workflow_run',
        externalId: String(run.id),
        repository: target.repository,
        ref: run.head_branch ?? null,
        sha: run.head_sha,
        version: run.run_number ? `#${run.run_number}` : versionOf(run.head_branch, run.head_sha),
        status,
        statusAt: at,
        url: run.html_url,
        creator: run.triggering_actor?.login ?? run.actor?.login ?? null,
        workflow: run.name ?? null,
        startedAt,
        finishedAt: FINISHED_STATUSES.has(status) ? at : null,
        createdAt: new Date(run.created_at),
      })
      .onConflictDoUpdate({
        target: targetColumns,
        set: {
          status: sql`excluded.status`,
          statusAt: sql`excluded.status_at`,
          startedAt: sql`coalesce(${deployments.startedAt}, excluded.started_at)`,
          finishedAt: sql`excluded.finished_at`,
          url: sql`excluded.url`,
        },
        setWhere: sql`excluded.status_at >= ${deployments.statusAt}`,
      })
      .returning({ id: deployments.id });
    const id =
      row?.id ??
      (
        await tx
          .select({ id: deployments.id })
          .from(deployments)
          .where(
            and(
              eq(deployments.projectId, target.projectId),
              eq(deployments.source, 'github'),
              eq(deployments.kind, 'workflow_run'),
              eq(deployments.externalId, String(run.id)),
            ),
          )
      )[0]?.id;
    if (!id) throw new Error('Workflow run upsert returned no row');
    // The history keeps one entry per status the run went through.
    await tx
      .insert(deploymentEvents)
      .values({
        organizationId: target.organizationId,
        deploymentId: id,
        status,
        externalId: status,
        occurredAt: at,
      })
      .onConflictDoNothing();
  }

  /**
   * Records a status event once (by its external id) and makes it the deployment's status unless
   * a newer one is already in place.
   */
  async applyStatus(
    tx: DbExecutor,
    deployment: DeploymentRow,
    change: StatusChange,
  ): Promise<void> {
    const [event] = await tx
      .insert(deploymentEvents)
      .values({
        organizationId: deployment.organizationId,
        deploymentId: deployment.id,
        status: change.status,
        description: change.description ?? null,
        externalId: change.externalId,
        occurredAt: change.at,
      })
      .onConflictDoNothing()
      .returning({ id: deploymentEvents.id });
    if (!event) return; // seen before
    const finished = FINISHED_STATUSES.has(change.status);
    await tx
      .update(deployments)
      .set({
        status: change.status,
        statusAt: change.at,
        description: change.description ?? sql`${deployments.description}`,
        url: change.url ?? sql`${deployments.url}`,
        environmentUrl: change.environmentUrl ?? sql`${deployments.environmentUrl}`,
        startedAt:
          change.status === 'queued'
            ? sql`${deployments.startedAt}`
            : sql`coalesce(${deployments.startedAt}, ${change.at.toISOString()}::timestamptz)`,
        finishedAt: finished ? change.at : null,
      })
      .where(
        and(
          eq(deployments.id, deployment.id),
          sql`${deployments.statusAt} <= ${change.at.toISOString()}::timestamptz`,
        ),
      );
  }

  /** A project's deployments and runs, newest first, filtered and paged by cursor. */
  async list(
    organizationId: string,
    projectId: string,
    query: DeploymentQuery,
  ): Promise<DeploymentPage | 'invalid_cursor'> {
    const position = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    if (position === null) return 'invalid_cursor';
    const rows = await this.database.withTenant({ organizationId }, (tx) =>
      tx
        .select({
          deployment: deployments,
          environmentName: environments.name,
          at: preciseTimestamp(deployments.createdAt),
        })
        .from(deployments)
        .leftJoin(environments, eq(environments.id, deployments.environmentId))
        .where(
          and(
            eq(deployments.organizationId, organizationId),
            eq(deployments.projectId, projectId),
            query.environmentId ? eq(deployments.environmentId, query.environmentId) : undefined,
            query.status ? eq(deployments.status, query.status) : undefined,
            query.kind ? eq(deployments.kind, query.kind) : undefined,
            position ? after(deployments.createdAt, deployments.id, position) : undefined,
          ),
        )
        .orderBy(desc(deployments.createdAt), desc(deployments.id))
        .limit(query.limit + 1),
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      deployments: page.map((row) => toDeployment(row.deployment, row.environmentName)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ at: last.at, id: last.deployment.id })
          : null,
    };
  }

  /** One deployment of the project, with its environment's name. */
  async get(
    tx: DbExecutor,
    projectId: string,
    deploymentId: string,
  ): Promise<Deployment | undefined> {
    const [row] = await tx
      .select({ deployment: deployments, environmentName: environments.name })
      .from(deployments)
      .leftJoin(environments, eq(environments.id, deployments.environmentId))
      .where(and(eq(deployments.projectId, projectId), eq(deployments.id, deploymentId)));
    return row ? toDeployment(row.deployment, row.environmentName) : undefined;
  }
}

export function toDeployment(row: DeploymentRow, environmentName: string | null): Deployment {
  const duration =
    row.startedAt && row.finishedAt
      ? Math.max(0, Math.round((row.finishedAt.getTime() - row.startedAt.getTime()) / 1000))
      : null;
  return {
    id: row.id,
    kind: row.kind,
    source: row.source,
    environment:
      row.environmentId && environmentName
        ? { id: row.environmentId, name: environmentName }
        : null,
    repository: row.repository,
    ref: row.ref,
    sha: row.sha,
    version: row.version,
    status: row.status,
    description: row.description,
    url: row.url,
    environmentUrl: row.environmentUrl,
    creator: row.creator,
    workflow: row.workflow,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationSeconds: duration,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
