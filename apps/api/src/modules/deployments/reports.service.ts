import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  Deployment,
  ReportDeploymentRequest,
  UpdateReportedDeploymentRequest,
} from '@forgeflow/contracts';
import { deployments, idempotencyKeys, type DatabaseHandle } from '@forgeflow/database';
import { and, eq } from 'drizzle-orm';
import { CLOCK, DATABASE } from '../../common/constants/injection-tokens.js';
import type { ApiTokenContext } from '../../common/types/api-token.types.js';
import type { Clock } from '../../common/types/clock.types.js';
import { FINISHED_STATUSES, versionOf } from '../../common/utils/deployment-status.util.js';
import { DeploymentsService } from './deployments.service.js';

export type ReportOutcome =
  | { status: 'created' | 'replayed'; deployment: Deployment }
  /** The Idempotency-Key was used before for a different request. */
  | { status: 'key_reused' };

/** JSON with sorted keys: equal requests hash alike whatever order their fields came in. */
function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

/**
 * The report API: pipelines that do not use GitHub Deployments tell ForgeFlow about their
 * deployments with a project API token. Creating one needs an Idempotency-Key: retrying the same
 * request gives back the same deployment, never a second one.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly now: Clock,
    @Inject(DeploymentsService) private readonly deployments: DeploymentsService,
  ) {}

  async report(
    token: ApiTokenContext,
    key: string,
    body: ReportDeploymentRequest,
  ): Promise<ReportOutcome> {
    const { organizationId, projectId } = token;
    const requestHash = createHash('sha256').update(stableJson(body)).digest('hex');
    const scope = `deployments.create:${projectId}`;
    return this.database.withTenant({ organizationId }, async (tx): Promise<ReportOutcome> => {
      // A concurrent request with the same key waits here until this one commits.
      const [claimed] = await tx
        .insert(idempotencyKeys)
        .values({ organizationId, scope, key, requestHash })
        .onConflictDoNothing()
        .returning({ id: idempotencyKeys.id });
      if (!claimed) {
        const [earlier] = await tx
          .select()
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.organizationId, organizationId),
              eq(idempotencyKeys.scope, scope),
              eq(idempotencyKeys.key, key),
            ),
          );
        if (!earlier?.resourceId || earlier.requestHash !== requestHash) {
          return { status: 'key_reused' };
        }
        const deployment = await this.deployments.get(tx, projectId, earlier.resourceId);
        if (!deployment) return { status: 'key_reused' };
        return { status: 'replayed', deployment };
      }

      const environment = await this.deployments.ensureEnvironment(
        tx,
        organizationId,
        projectId,
        body.environment,
      );
      const now = this.now();
      const [row] = await tx
        .insert(deployments)
        .values({
          organizationId,
          projectId,
          environmentId: environment.id,
          source: 'api',
          kind: 'deployment',
          externalId: key,
          environmentName: body.environment,
          ref: body.ref ?? null,
          sha: body.sha ?? null,
          version: body.version ?? versionOf(body.ref, body.sha),
          status: body.status,
          statusAt: now,
          description: body.description ?? null,
          url: body.url ?? null,
          environmentUrl: body.environmentUrl ?? null,
          creator: body.creator ?? null,
          startedAt: body.status === 'queued' ? null : now,
          finishedAt: FINISHED_STATUSES.has(body.status) ? now : null,
          createdAt: now,
        })
        .returning();
      if (!row) throw new Error('Deployment insert returned no row');
      // The first entry of its status history.
      await this.deployments.applyStatus(tx, row, {
        status: body.status,
        at: now,
        externalId: null,
        description: body.description ?? null,
      });
      await tx
        .update(idempotencyKeys)
        .set({ resourceId: row.id })
        .where(eq(idempotencyKeys.id, claimed.id));
      const deployment = await this.deployments.get(tx, projectId, row.id);
      if (!deployment) throw new Error('Reported deployment vanished');
      return { status: 'created', deployment };
    });
  }

  /** A later status of a deployment this project reported; undefined when there is none. */
  async update(
    token: ApiTokenContext,
    deploymentId: string,
    body: UpdateReportedDeploymentRequest,
  ): Promise<Deployment | undefined> {
    const { organizationId, projectId } = token;
    return this.database.withTenant({ organizationId }, async (tx) => {
      const [row] = await tx
        .select()
        .from(deployments)
        .where(
          and(
            eq(deployments.organizationId, organizationId),
            eq(deployments.projectId, projectId),
            eq(deployments.id, deploymentId),
            eq(deployments.source, 'api'),
          ),
        );
      if (!row) return undefined;
      await this.deployments.applyStatus(tx, row, {
        status: body.status,
        at: this.now(),
        externalId: null,
        description: body.description ?? null,
        url: body.url ?? null,
        environmentUrl: body.environmentUrl ?? null,
      });
      return this.deployments.get(tx, projectId, deploymentId);
    });
  }
}
