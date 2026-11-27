import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  can,
  createEnvironmentRequestSchema,
  updateEnvironmentRequestSchema,
  type CreateEnvironmentRequest,
  type Environment,
  type UpdateEnvironmentRequest,
} from '@forgeflow/contracts';
import { z } from 'zod';
import { CurrentMembership } from '../../common/decorators/current-membership.decorator.js';
import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { MembershipContext } from '../../common/types/organization.types.js';
import { roleNotAllowed } from '../../common/utils/organization-errors.util.js';
import {
  environmentNotFound,
  nameTaken,
  projectNotFound,
} from '../../common/utils/project-errors.util.js';
import { EnvironmentsService } from './environments.service.js';

const ENVIRONMENT_NAME_TAKEN = 'This project already has an environment with this name.';

/**
 * Protecting or unprotecting decides who must approve changes to an environment (Phase 6), so
 * it needs environments.protect on top of the route's projects.manage.
 */
function assertMayProtect(membership: MembershipContext): void {
  if (!can(membership.role, 'environments.protect')) {
    throw roleNotAllowed('Your role cannot protect or unprotect environments.');
  }
}

@Controller('organizations/:orgId/projects/:projectId/environments')
export class EnvironmentsController {
  constructor(@Inject(EnvironmentsService) private readonly environments: EnvironmentsService) {}

  /** Adds an environment after the project's others. */
  @Post()
  @RequirePermission('projects.manage')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentMembership() membership: MembershipContext,
    @Param('projectId', new ZodValidationPipe(z.uuid())) projectId: string,
    @Body(new ZodValidationPipe(createEnvironmentRequestSchema)) body: CreateEnvironmentRequest,
  ): Promise<Environment> {
    if (body.protected) assertMayProtect(membership);
    const outcome = await this.environments.create(membership.organizationId, projectId, body);
    switch (outcome.status) {
      case 'created':
        return outcome.environment;
      case 'project_not_found':
        throw projectNotFound();
      case 'name_taken':
        throw nameTaken(ENVIRONMENT_NAME_TAKEN);
    }
  }

  /** Renames an environment, protects or unprotects it, or both. */
  @Patch(':environmentId')
  @RequirePermission('projects.manage')
  async update(
    @CurrentMembership() membership: MembershipContext,
    @Param('projectId', new ZodValidationPipe(z.uuid())) projectId: string,
    @Param('environmentId', new ZodValidationPipe(z.uuid())) environmentId: string,
    @Body(new ZodValidationPipe(updateEnvironmentRequestSchema)) body: UpdateEnvironmentRequest,
  ): Promise<Environment> {
    if (body.protected !== undefined) assertMayProtect(membership);
    const outcome = await this.environments.update(
      membership.organizationId,
      projectId,
      environmentId,
      body,
    );
    switch (outcome.status) {
      case 'updated':
        return outcome.environment;
      case 'not_found':
        throw environmentNotFound();
      case 'name_taken':
        throw nameTaken(ENVIRONMENT_NAME_TAKEN);
    }
  }
}
