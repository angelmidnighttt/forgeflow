import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  createProjectRequestSchema,
  updateProjectRequestSchema,
  type CreateProjectRequest,
  type Project,
  type UpdateProjectRequest,
} from '@forgeflow/contracts';
import { z } from 'zod';
import { CurrentActor } from '../../common/decorators/current-actor.decorator.js';
import { CurrentMembership } from '../../common/decorators/current-membership.decorator.js';
import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuditActor } from '../../common/types/audit.types.js';
import type { MembershipContext } from '../../common/types/organization.types.js';
import { nameTaken, projectNotFound } from '../../common/utils/project-errors.util.js';
import { ProjectsService } from './projects.service.js';

const PROJECT_NAME_TAKEN = 'This organization already has a project with this name.';

@Controller('organizations/:orgId/projects')
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermission('projects.read')
  list(@CurrentMembership() membership: MembershipContext): Promise<Project[]> {
    return this.projects.list(membership.organizationId);
  }

  /** Creates a project with the environments development, staging and production (protected). */
  @Post()
  @RequirePermission('projects.manage')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentMembership() membership: MembershipContext,
    @CurrentActor() actor: AuditActor,
    @Body(new ZodValidationPipe(createProjectRequestSchema)) body: CreateProjectRequest,
  ): Promise<Project> {
    const outcome = await this.projects.create(membership.organizationId, body.name, actor);
    if (outcome.status === 'name_taken') throw nameTaken(PROJECT_NAME_TAKEN);
    return outcome.project;
  }

  @Get(':projectId')
  @RequirePermission('projects.read')
  async get(
    @CurrentMembership() membership: MembershipContext,
    @Param('projectId', new ZodValidationPipe(z.uuid())) projectId: string,
  ): Promise<Project> {
    const project = await this.projects.get(membership.organizationId, projectId);
    if (!project) throw projectNotFound();
    return project;
  }

  @Patch(':projectId')
  @RequirePermission('projects.manage')
  async rename(
    @CurrentMembership() membership: MembershipContext,
    @CurrentActor() actor: AuditActor,
    @Param('projectId', new ZodValidationPipe(z.uuid())) projectId: string,
    @Body(new ZodValidationPipe(updateProjectRequestSchema)) body: UpdateProjectRequest,
  ): Promise<Project> {
    const outcome = await this.projects.rename(
      membership.organizationId,
      projectId,
      body.name,
      actor,
    );
    switch (outcome.status) {
      case 'renamed':
        return outcome.project;
      case 'not_found':
        throw projectNotFound();
      case 'name_taken':
        throw nameTaken(PROJECT_NAME_TAKEN);
    }
  }
}
