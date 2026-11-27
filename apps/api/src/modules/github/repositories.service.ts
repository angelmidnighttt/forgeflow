import { Inject, Injectable } from '@nestjs/common';
import type { Repository } from '@forgeflow/contracts';
import {
  integrations,
  outboxEvents,
  projects,
  repositories,
  type DatabaseHandle,
  type DbExecutor,
  type RepositoryRow,
} from '@forgeflow/database';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { API_ENV, DATABASE } from '../../common/constants/injection-tokens.js';
import type { AuditActor } from '../../common/types/audit.types.js';
import type { GithubRepository } from '../../common/types/github.types.js';
import type { ApiEnv } from '../../config/env.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

/**
 * The repositories of GitHub integrations, kept in step with what each installation can see,
 * and their mapping to projects. Queries run in the organization's tenant context (ADR-0002).
 */
@Injectable()
export class RepositoriesService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /** Adds or refreshes `repos` of the integration within `tx`, keeping their project mapping. */
  async upsert(
    tx: DbExecutor,
    organizationId: string,
    integrationId: string,
    repos: GithubRepository[],
  ): Promise<void> {
    if (repos.length === 0) return;
    await tx
      .insert(repositories)
      .values(
        repos.map((repo) => ({
          organizationId,
          integrationId,
          externalId: String(repo.id),
          fullName: repo.full_name,
          htmlUrl: repo.html_url ?? new URL(repo.full_name, this.env.GITHUB_URL).toString(),
          defaultBranch: repo.default_branch ?? null,
          private: repo.private,
        })),
      )
      .onConflictDoUpdate({
        target: [repositories.integrationId, repositories.externalId],
        set: {
          fullName: sql`excluded.full_name`,
          htmlUrl: sql`excluded.html_url`,
          defaultBranch: sql`coalesce(excluded.default_branch, ${repositories.defaultBranch})`,
          private: sql`excluded.private`,
          updatedAt: sql`now()`,
        },
      });
  }

  /** Makes the integration's repositories exactly `repos` (a full list from GitHub). */
  async replaceAll(
    tx: DbExecutor,
    organizationId: string,
    integrationId: string,
    repos: GithubRepository[],
  ): Promise<void> {
    await this.upsert(tx, organizationId, integrationId, repos);
    const keep = repos.map((repo) => String(repo.id));
    await tx
      .delete(repositories)
      .where(
        and(
          eq(repositories.integrationId, integrationId),
          keep.length > 0 ? notInArray(repositories.externalId, keep) : undefined,
        ),
      );
  }

  /** Forgets repositories the installation can no longer see. */
  async remove(tx: DbExecutor, integrationId: string, externalIds: string[]): Promise<void> {
    if (externalIds.length === 0) return;
    await tx
      .delete(repositories)
      .where(
        and(
          eq(repositories.integrationId, integrationId),
          inArray(repositories.externalId, externalIds),
        ),
      );
  }

  /** The repository GitHub calls `externalId` in an integration, if ForgeFlow knows it. */
  async find(
    tx: DbExecutor,
    integrationId: string,
    externalId: string,
  ): Promise<RepositoryRow | undefined> {
    const [row] = await tx
      .select()
      .from(repositories)
      .where(
        and(eq(repositories.integrationId, integrationId), eq(repositories.externalId, externalId)),
      )
      .limit(1);
    return row;
  }

  /** The mapped repositories of an integration (the job that catches up on missed webhooks). */
  async mapped(tx: DbExecutor, integrationId: string): Promise<RepositoryRow[]> {
    return tx
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.integrationId, integrationId),
          sql`${repositories.projectId} IS NOT NULL`,
        ),
      );
  }

  async listForIntegration(organizationId: string, integrationId: string): Promise<Repository[]> {
    const rows = await this.database.withTenant({ organizationId }, (tx) =>
      tx
        .select()
        .from(repositories)
        .where(
          and(
            eq(repositories.organizationId, organizationId),
            eq(repositories.integrationId, integrationId),
          ),
        )
        .orderBy(asc(sql`lower(${repositories.fullName})`)),
    );
    return rows.map(toRepository);
  }

  /** Sends a repository's deployments to `projectId` (null: nowhere). */
  async map(
    actor: AuditActor,
    organizationId: string,
    repositoryId: string,
    projectId: string | null,
  ): Promise<
    { status: 'mapped'; repository: Repository } | { status: 'not_found' | 'project_not_found' }
  > {
    return this.database.withTenant({ organizationId }, async (tx) => {
      let projectName: string | null = null;
      if (projectId) {
        const [project] = await tx
          .select({ name: projects.name })
          .from(projects)
          .where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)));
        if (!project) return { status: 'project_not_found' as const };
        projectName = project.name;
      }
      const [row] = await tx
        .update(repositories)
        .set({ projectId })
        .where(
          and(eq(repositories.organizationId, organizationId), eq(repositories.id, repositoryId)),
        )
        .returning();
      if (!row) return { status: 'not_found' as const };
      await this.audit.record(tx, {
        organizationId,
        actor,
        action: 'repository.mapped',
        target: { type: 'repository', id: repositoryId },
        metadata: { repository: row.fullName, projectId, project: projectName },
      });
      // The project sees the repository's history now, not at the next scheduled catch-up.
      if (projectId) await this.queueCatchUp(tx, organizationId, row.integrationId);
      return { status: 'mapped' as const, repository: toRepository(row) };
    });
  }

  /**
   * Queues the integration's catch-up job (github.reconcile: the latest deployments and runs of
   * its mapped repositories) unless one is still waiting. One already running may have read the
   * mapping before this change, so it does not count.
   */
  private async queueCatchUp(
    tx: DbExecutor,
    organizationId: string,
    integrationId: string,
  ): Promise<void> {
    const [integration] = await tx
      .select({ externalId: integrations.externalId, status: integrations.status })
      .from(integrations)
      .where(
        and(eq(integrations.organizationId, organizationId), eq(integrations.id, integrationId)),
      );
    if (!integration?.externalId || integration.status !== 'active') return;
    const [waiting] = await tx
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, organizationId),
          eq(outboxEvents.topic, 'github.reconcile'),
          eq(outboxEvents.status, 'pending'),
          sql`${outboxEvents.payload} ->> 'integrationId' = ${integrationId}`,
        ),
      )
      .limit(1);
    if (waiting) return;
    await this.outbox.enqueue(tx, {
      organizationId,
      topic: 'github.reconcile',
      payload: { integrationId, installationId: integration.externalId },
    });
  }
}

export function toRepository(row: RepositoryRow): Repository {
  return {
    id: row.id,
    integrationId: row.integrationId,
    fullName: row.fullName,
    htmlUrl: row.htmlUrl,
    defaultBranch: row.defaultBranch,
    private: row.private,
    projectId: row.projectId,
    updatedAt: row.updatedAt.toISOString(),
  };
}
