import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DatabaseHandle, DbExecutor } from '@forgeflow/database';
import { DATABASE } from '../../common/constants/injection-tokens.js';
import type {
  GithubDeployment,
  GithubDeploymentStatus,
  GithubWorkflowRun,
} from '../../common/types/github.types.js';
import type {
  ClaimedOutboxEvent,
  GithubWebhookEventPayload,
} from '../../common/types/outbox.types.js';
import { PermanentOutboxError } from '../../common/utils/outbox.util.js';
import { DeploymentsService, type DeploymentTarget } from '../deployments/deployments.service.js';
import { GithubInstallationsService } from './github-installations.service.js';
import { RepositoriesService } from './repositories.service.js';

/** Reads the payload forgeflow_record_webhook_delivery() wrote; a malformed one is permanent. */
export function githubWebhookPayload(event: ClaimedOutboxEvent): GithubWebhookEventPayload {
  const p = event.payload;
  if (
    typeof p.deliveryId !== 'string' ||
    typeof p.event !== 'string' ||
    typeof p.body !== 'object' ||
    p.body === null
  ) {
    throw new PermanentOutboxError('Malformed github.webhook payload');
  }
  return {
    deliveryId: p.deliveryId,
    event: p.event,
    action: typeof p.action === 'string' ? p.action : null,
    installationId: typeof p.installationId === 'string' ? p.installationId : null,
    integrationId: typeof p.integrationId === 'string' ? p.integrationId : null,
    body: p.body as Record<string, unknown>,
  };
}

function objectField<T>(body: Record<string, unknown>, field: string): T {
  const value = body[field];
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { id?: unknown }).id !== 'number'
  ) {
    throw new PermanentOutboxError(`GitHub payload without a valid "${field}"`);
  }
  return value as T;
}

/**
 * Handles GitHub webhooks in the worker (topic github.webhook). Every handler is idempotent: a
 * redelivered or reclaimed event changes nothing the second time. Events of installations that
 * no organization connected, and of repositories mapped to no project, are ignored.
 */
@Injectable()
export class GithubWebhooksService {
  private readonly logger = new Logger(GithubWebhooksService.name);

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(GithubInstallationsService) private readonly installations: GithubInstallationsService,
    @Inject(RepositoriesService) private readonly repositories: RepositoriesService,
    @Inject(DeploymentsService) private readonly deployments: DeploymentsService,
  ) {}

  async handle(event: ClaimedOutboxEvent): Promise<void> {
    const webhook = githubWebhookPayload(event);
    const organizationId = event.organizationId;
    const body = webhook.body;
    switch (webhook.event) {
      case 'installation':
        return this.installations.onInstallationEvent(webhook, organizationId);
      case 'installation_repositories':
        return this.installations.onInstallationRepositoriesEvent(webhook, organizationId);
      case 'deployment':
        if (webhook.action !== 'created') return;
        return this.inProject(webhook, organizationId, (tx, target) =>
          this.deployments.recordGithubDeployment(
            tx,
            target,
            objectField<GithubDeployment>(body, 'deployment'),
          ),
        );
      case 'deployment_status':
        return this.inProject(webhook, organizationId, (tx, target) =>
          this.deployments.applyGithubDeploymentStatus(
            tx,
            target,
            objectField<GithubDeployment>(body, 'deployment'),
            objectField<GithubDeploymentStatus>(body, 'deployment_status'),
          ),
        );
      case 'workflow_run':
        return this.inProject(webhook, organizationId, (tx, target) =>
          this.deployments.recordWorkflowRun(
            tx,
            target,
            objectField<GithubWorkflowRun>(body, 'workflow_run'),
          ),
        );
      default:
        this.logger.debug({ event: webhook.event }, 'GitHub event not handled; ignored');
    }
  }

  /** Runs `work` for the project the webhook's repository is mapped to, if any. */
  private async inProject(
    webhook: GithubWebhookEventPayload,
    organizationId: string | null,
    work: (tx: DbExecutor, target: DeploymentTarget) => Promise<unknown>,
  ): Promise<void> {
    const integrationId = webhook.integrationId;
    if (!organizationId || !integrationId) return;
    const repository = objectField<{ id: number }>(webhook.body, 'repository');
    await this.database.withTenant({ organizationId }, async (tx) => {
      const repo = await this.repositories.find(tx, integrationId, String(repository.id));
      if (!repo?.projectId) return;
      await work(tx, { organizationId, projectId: repo.projectId, repository: repo.fullName });
    });
  }
}
