import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { DeploymentsModule } from '../deployments/deployments.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { GithubAppService } from './github-app.service.js';
import { GithubInstallationsService } from './github-installations.service.js';
import { GithubReconcileService } from './github-reconcile.service.js';
import { GithubWebhooksService } from './github-webhooks.service.js';
import { GithubController } from './github.controller.js';
import { RepositoriesController } from './repositories.controller.js';
import { RepositoriesService } from './repositories.service.js';

/**
 * The GitHub App: connecting installations, their repositories and project mapping, and (in the
 * worker) handling its webhooks and the catch-up job.
 */
@Module({
  imports: [AuditModule, IntegrationsModule, DeploymentsModule, OutboxModule, WebhooksModule],
  controllers: [GithubController, RepositoriesController],
  providers: [
    GithubAppService,
    GithubInstallationsService,
    RepositoriesService,
    GithubWebhooksService,
    GithubReconcileService,
  ],
  exports: [GithubWebhooksService, GithubReconcileService, GithubAppService],
})
export class GithubModule {}
