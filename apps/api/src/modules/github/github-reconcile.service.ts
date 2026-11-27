import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseHandle } from '@forgeflow/database';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../../common/constants/injection-tokens.js';
import type { ClaimedOutboxEvent } from '../../common/types/outbox.types.js';
import { FINISHED_STATUSES } from '../../common/utils/deployment-status.util.js';
import { PermanentOutboxError } from '../../common/utils/outbox.util.js';
import { DeploymentsService } from '../deployments/deployments.service.js';
import { GithubAppService } from './github-app.service.js';
import { RepositoriesService } from './repositories.service.js';

/** How often the worker schedules the catch-up job for every GitHub integration. */
export const RECONCILE_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Catches up on webhooks GitHub did not deliver (it does not promise to): reads the latest
 * deployments, their statuses and Actions runs of every mapped repository and records them
 * exactly as webhooks would, so nothing is counted twice.
 */
@Injectable()
export class GithubReconcileService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(GithubAppService) private readonly github: GithubAppService,
    @Inject(RepositoriesService) private readonly repositories: RepositoriesService,
    @Inject(DeploymentsService) private readonly deployments: DeploymentsService,
  ) {}

  /** Enqueues one github.reconcile event per active integration that has none waiting. */
  async schedule(): Promise<number> {
    if (!this.github.app) return 0;
    const result = await this.database.db.execute<{ count: number }>(
      sql`select forgeflow_enqueue_github_reconcile() as count`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /** The worker's handling of a github.reconcile event. */
  async handle(event: ClaimedOutboxEvent): Promise<void> {
    const organizationId = event.organizationId;
    const { integrationId, installationId } = event.payload;
    if (
      !organizationId ||
      typeof integrationId !== 'string' ||
      typeof installationId !== 'string'
    ) {
      throw new PermanentOutboxError('Malformed github.reconcile payload');
    }
    const mapped = await this.database.withTenant({ organizationId }, (tx) =>
      this.repositories.mapped(tx, integrationId),
    );
    for (const repo of mapped) {
      if (!repo.projectId) continue;
      const target = { organizationId, projectId: repo.projectId, repository: repo.fullName };

      const deployments = await this.github.deployments(installationId, repo.fullName);
      const known = await this.database.withTenant({ organizationId }, (tx) =>
        this.deployments.githubDeploymentStatuses(
          tx,
          target.projectId,
          deployments.map((deployment) => String(deployment.id)),
        ),
      );
      for (const deployment of deployments) {
        // A finished deployment needs no more calls: the job then costs two requests per
        // repository (deployments, runs), well within the installation's hourly rate limit. What
        // it can miss is a success turning inactive, which the webhook still brings.
        const status = known.get(String(deployment.id));
        if (status && FINISHED_STATUSES.has(status)) continue;
        // Oldest first, so each status lands in order.
        const statuses = (
          await this.github.deploymentStatuses(installationId, repo.fullName, deployment.id)
        ).reverse();
        await this.database.withTenant({ organizationId }, async (tx) => {
          await this.deployments.recordGithubDeployment(tx, target, deployment);
          for (const status of statuses) {
            await this.deployments.applyGithubDeploymentStatus(tx, target, deployment, status);
          }
        });
      }

      const runs = await this.github.workflowRuns(installationId, repo.fullName);
      await this.database.withTenant({ organizationId }, async (tx) => {
        for (const run of runs) await this.deployments.recordWorkflowRun(tx, target, run);
      });
    }
  }
}
