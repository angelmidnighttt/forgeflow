import { BadRequestException, Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
  deploymentQuerySchema,
  ErrorCode,
  type DeploymentPage,
  type DeploymentQuery,
} from '@forgeflow/contracts';
import { z } from 'zod';
import { CurrentMembership } from '../../common/decorators/current-membership.decorator.js';
import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { MembershipContext } from '../../common/types/organization.types.js';
import { DeploymentsService } from './deployments.service.js';

@Controller('organizations/:orgId/projects/:projectId/deployments')
export class DeploymentsController {
  constructor(@Inject(DeploymentsService) private readonly deployments: DeploymentsService) {}

  /** The project's deployments and CI runs, newest first; filters and `?cursor=` for more. */
  @Get()
  @RequirePermission('projects.read')
  async list(
    @CurrentMembership() membership: MembershipContext,
    @Param('projectId', new ZodValidationPipe(z.uuid())) projectId: string,
    @Query(new ZodValidationPipe(deploymentQuerySchema)) query: DeploymentQuery,
  ): Promise<DeploymentPage> {
    const page = await this.deployments.list(membership.organizationId, projectId, query);
    if (page === 'invalid_cursor') {
      throw new BadRequestException({
        code: ErrorCode.BadRequest,
        message: 'This cursor is not valid; start again from the first page.',
      });
    }
    return page;
  }
}
