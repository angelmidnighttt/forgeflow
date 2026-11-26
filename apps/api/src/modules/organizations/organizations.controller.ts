import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Patch, Post } from '@nestjs/common';
import {
  createOrganizationRequestSchema,
  updateOrganizationRequestSchema,
  type CreateOrganizationRequest,
  type Organization,
  type UpdateOrganizationRequest,
} from '@forgeflow/contracts';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator.js';
import { CurrentMembership } from '../../common/decorators/current-membership.decorator.js';
import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthContext } from '../../common/types/auth.types.js';
import type { MembershipContext } from '../../common/types/organization.types.js';
import { signInRequired } from '../../common/utils/auth-errors.util.js';
import {
  emailNotVerified,
  organizationNotFound,
} from '../../common/utils/organization-errors.util.js';
import { UsersService } from '../users/users.service.js';
import { OrganizationsService } from './organizations.service.js';

@Controller('organizations')
export class OrganizationsController {
  constructor(
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  /** Creates an organization; the caller becomes its owner. Needs a verified email. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createOrganizationRequestSchema)) body: CreateOrganizationRequest,
  ): Promise<Organization> {
    const user = await this.users.findById(auth.userId);
    if (!user) throw signInRequired();
    if (!user.emailVerifiedAt) throw emailNotVerified();
    return this.organizations.create(user.id, body.name);
  }

  /** The organizations the caller belongs to, with their role in each. */
  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<Organization[]> {
    return this.organizations.listForUser(auth.userId);
  }

  @Get(':orgId')
  @RequirePermission('organization.read')
  async get(@CurrentMembership() membership: MembershipContext): Promise<Organization> {
    const organization = await this.organizations.get(membership.organizationId, membership.role);
    if (!organization) throw organizationNotFound();
    return organization;
  }

  @Patch(':orgId')
  @RequirePermission('organization.update')
  async update(
    @CurrentMembership() membership: MembershipContext,
    @Body(new ZodValidationPipe(updateOrganizationRequestSchema)) body: UpdateOrganizationRequest,
  ): Promise<Organization> {
    const organization = await this.organizations.rename(
      membership.organizationId,
      membership.role,
      body.name,
    );
    if (!organization) throw organizationNotFound();
    return organization;
  }
}
