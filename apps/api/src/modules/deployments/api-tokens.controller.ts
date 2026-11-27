import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  createApiTokenRequestSchema,
  ErrorCode,
  type ApiToken,
  type CreateApiTokenRequest,
  type CreatedApiToken,
} from '@forgeflow/contracts';
import { z } from 'zod';
import { CurrentActor } from '../../common/decorators/current-actor.decorator.js';
import { CurrentMembership } from '../../common/decorators/current-membership.decorator.js';
import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuditActor } from '../../common/types/audit.types.js';
import type { MembershipContext } from '../../common/types/organization.types.js';
import { projectNotFound } from '../../common/utils/project-errors.util.js';
import { ApiTokensService } from './api-tokens.service.js';

const projectIdPipe = new ZodValidationPipe(z.uuid());

/** A project's API tokens (owners and admins); a token's secret is shown when it is created. */
@Controller('organizations/:orgId/projects/:projectId/api-tokens')
export class ApiTokensController {
  constructor(@Inject(ApiTokensService) private readonly tokens: ApiTokensService) {}

  @Get()
  @RequirePermission('api_tokens.manage')
  list(
    @CurrentMembership() membership: MembershipContext,
    @Param('projectId', projectIdPipe) projectId: string,
  ): Promise<ApiToken[]> {
    return this.tokens.list(membership.organizationId, projectId);
  }

  @Post()
  @RequirePermission('api_tokens.manage')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  async create(
    @CurrentMembership() membership: MembershipContext,
    @CurrentActor() actor: AuditActor,
    @Param('projectId', projectIdPipe) projectId: string,
    @Body(new ZodValidationPipe(createApiTokenRequestSchema)) body: CreateApiTokenRequest,
  ): Promise<CreatedApiToken> {
    const created = await this.tokens.create(actor, membership.organizationId, projectId, body);
    if (!created) throw projectNotFound();
    return created;
  }

  /** Revokes a token: pipelines using it get 401 from now on. */
  @Delete(':tokenId')
  @RequirePermission('api_tokens.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentMembership() membership: MembershipContext,
    @CurrentActor() actor: AuditActor,
    @Param('projectId', projectIdPipe) projectId: string,
    @Param('tokenId', new ZodValidationPipe(z.uuid())) tokenId: string,
  ): Promise<void> {
    if (!(await this.tokens.revoke(actor, membership.organizationId, projectId, tokenId))) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'No such API token in use.',
      });
    }
  }
}
