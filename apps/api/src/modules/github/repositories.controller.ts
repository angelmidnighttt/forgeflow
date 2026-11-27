import { Body, Controller, Get, Inject, NotFoundException, Param, Patch } from '@nestjs/common';
import {
  ErrorCode,
  mapRepositoryRequestSchema,
  type MapRepositoryRequest,
  type Repository,
  type WebhookDelivery,
} from '@forgeflow/contracts';
import { z } from 'zod';
import { CurrentActor } from '../../common/decorators/current-actor.decorator.js';
import { CurrentMembership } from '../../common/decorators/current-membership.decorator.js';
import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuditActor } from '../../common/types/audit.types.js';
import type { MembershipContext } from '../../common/types/organization.types.js';
import { projectNotFound } from '../../common/utils/project-errors.util.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { RepositoriesService } from './repositories.service.js';

const uuid = new ZodValidationPipe(z.uuid());

/** A GitHub integration's repositories, their project mapping, and its recent webhooks. */
@Controller('organizations/:orgId')
export class RepositoriesController {
  constructor(
    @Inject(RepositoriesService) private readonly repositories: RepositoriesService,
    @Inject(WebhooksService) private readonly webhooks: WebhooksService,
  ) {}

  @Get('integrations/:integrationId/repositories')
  @RequirePermission('integrations.read')
  list(
    @CurrentMembership() membership: MembershipContext,
    @Param('integrationId', uuid) integrationId: string,
  ): Promise<Repository[]> {
    return this.repositories.listForIntegration(membership.organizationId, integrationId);
  }

  /** The latest webhooks GitHub sent for the integration, with how their handling went. */
  @Get('integrations/:integrationId/deliveries')
  @RequirePermission('integrations.read')
  deliveries(
    @CurrentMembership() membership: MembershipContext,
    @Param('integrationId', uuid) integrationId: string,
  ): Promise<WebhookDelivery[]> {
    return this.webhooks.listForIntegration(membership.organizationId, integrationId);
  }

  /** Sends a repository's deployments to a project of the organization (null: nowhere). */
  @Patch('repositories/:repositoryId')
  @RequirePermission('integrations.manage')
  async map(
    @CurrentMembership() membership: MembershipContext,
    @CurrentActor() actor: AuditActor,
    @Param('repositoryId', uuid) repositoryId: string,
    @Body(new ZodValidationPipe(mapRepositoryRequestSchema)) body: MapRepositoryRequest,
  ): Promise<Repository> {
    const outcome = await this.repositories.map(
      actor,
      membership.organizationId,
      repositoryId,
      body.projectId,
    );
    switch (outcome.status) {
      case 'mapped':
        return outcome.repository;
      case 'project_not_found':
        throw projectNotFound();
      case 'not_found':
        throw new NotFoundException({ code: ErrorCode.NotFound, message: 'Repository not found.' });
    }
  }
}
