import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import {
  rotateIntegrationSecretRequestSchema,
  SECRET_NAME_PATTERN,
  type Integration,
  type RotatedIntegrationSecret,
  type RotateIntegrationSecretRequest,
} from '@forgeflow/contracts';
import { z } from 'zod';
import { CurrentActor } from '../../common/decorators/current-actor.decorator.js';
import { CurrentMembership } from '../../common/decorators/current-membership.decorator.js';
import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuditActor } from '../../common/types/audit.types.js';
import type { MembershipContext } from '../../common/types/organization.types.js';
import {
  integrationNotFound,
  secretNotFound,
  secretValueNotAllowed,
  secretValueRequired,
} from '../../common/utils/integration-errors.util.js';
import { IntegrationSecretsService } from './integration-secrets.service.js';
import { IntegrationsService } from './integrations.service.js';

const secretName = new ZodValidationPipe(z.string().regex(SECRET_NAME_PATTERN));

/**
 * An organization's integrations. No route ever returns a secret's value, except the one-time
 * answer to rotating a secret that ForgeFlow generates.
 */
@Controller('organizations/:orgId/integrations')
export class IntegrationsController {
  constructor(
    @Inject(IntegrationsService) private readonly integrations: IntegrationsService,
    @Inject(IntegrationSecretsService) private readonly secrets: IntegrationSecretsService,
  ) {}

  @Get()
  @RequirePermission('integrations.read')
  list(@CurrentMembership() membership: MembershipContext): Promise<Integration[]> {
    return this.integrations.list(membership.organizationId);
  }

  @Get(':integrationId')
  @RequirePermission('integrations.read')
  async get(
    @CurrentMembership() membership: MembershipContext,
    @Param('integrationId', new ZodValidationPipe(z.uuid())) integrationId: string,
  ): Promise<Integration> {
    const integration = await this.integrations.get(membership.organizationId, integrationId);
    if (!integration) throw integrationNotFound();
    return integration;
  }

  /**
   * Replaces a secret with a new version and revokes the old one. A generated secret's new value
   * is in this answer and nowhere else afterwards; a provided one needs `value`.
   */
  @Post(':integrationId/secrets/:name/rotate')
  @RequirePermission('integrations.manage')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async rotate(
    @CurrentMembership() membership: MembershipContext,
    @CurrentActor() actor: AuditActor,
    @Param('integrationId', new ZodValidationPipe(z.uuid())) integrationId: string,
    @Param('name', secretName) name: string,
    @Body(new ZodValidationPipe(rotateIntegrationSecretRequestSchema))
    body: RotateIntegrationSecretRequest,
  ): Promise<RotatedIntegrationSecret> {
    const outcome = await this.secrets.rotate(
      actor,
      membership.organizationId,
      integrationId,
      name,
      body.value,
    );
    switch (outcome.status) {
      case 'rotated':
        return { secret: outcome.secret, value: outcome.value };
      case 'integration_not_found':
        throw integrationNotFound();
      case 'secret_not_found':
        throw secretNotFound();
      case 'value_required':
        throw secretValueRequired();
      case 'value_not_allowed':
        throw secretValueNotAllowed();
    }
  }

  /** Revokes a secret: nothing can use it until it is rotated. Revoking twice is fine. */
  @Delete(':integrationId/secrets/:name')
  @RequirePermission('integrations.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentMembership() membership: MembershipContext,
    @CurrentActor() actor: AuditActor,
    @Param('integrationId', new ZodValidationPipe(z.uuid())) integrationId: string,
    @Param('name', secretName) name: string,
  ): Promise<void> {
    const outcome = await this.secrets.revoke(
      actor,
      membership.organizationId,
      integrationId,
      name,
    );
    if (outcome.status === 'integration_not_found') throw integrationNotFound();
    if (outcome.status === 'secret_not_found') throw secretNotFound();
  }
}
