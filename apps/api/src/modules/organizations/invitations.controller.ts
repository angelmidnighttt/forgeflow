import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createInvitationRequestSchema,
  ErrorCode,
  type CreateInvitationRequest,
  type Invitation,
} from '@forgeflow/contracts';
import { z } from 'zod';
import { RATE_LIMITS } from '../../common/constants/rate-limit.constants.js';
import { CurrentMembership } from '../../common/decorators/current-membership.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { MembershipContext } from '../../common/types/organization.types.js';
import { signInRequired } from '../../common/utils/auth-errors.util.js';
import { emailNotVerified, roleNotAllowed } from '../../common/utils/organization-errors.util.js';
import { UsersService } from '../users/users.service.js';
import { InvitationsService } from './invitations.service.js';

/** Invitations sent by an organization (owners and admins). */
@Controller('organizations/:orgId/invitations')
export class InvitationsController {
  constructor(
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  /** Emails an invitation. Needs a verified email, and a role the inviter may assign. */
  @Post()
  @RequirePermission('invitations.manage')
  @RateLimit(RATE_LIMITS.invitePerUser)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentMembership() membership: MembershipContext,
    @Body(new ZodValidationPipe(createInvitationRequestSchema)) body: CreateInvitationRequest,
  ): Promise<Invitation> {
    const inviter = await this.users.findById(membership.userId);
    if (!inviter) throw signInRequired();
    if (!inviter.emailVerifiedAt) throw emailNotVerified();

    const outcome = await this.invitations.create(membership, body);
    switch (outcome.status) {
      case 'created':
        return outcome.invitation;
      case 'role_not_allowed':
        throw roleNotAllowed('Your role cannot invite people with that role.');
      case 'already_member':
        throw new ConflictException({
          code: ErrorCode.AlreadyMember,
          message: 'This person is already a member of the organization.',
        });
      case 'send_failed':
        throw new ServiceUnavailableException({
          code: ErrorCode.ServiceUnavailable,
          message: 'The invitation email could not be sent. Try again in a few minutes.',
        });
    }
  }

  @Get()
  @RequirePermission('invitations.manage')
  list(@CurrentMembership() membership: MembershipContext): Promise<Invitation[]> {
    return this.invitations.listPending(membership.organizationId);
  }

  /** Withdraws an invitation: its link stops working. */
  @Delete(':invitationId')
  @RequirePermission('invitations.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentMembership() membership: MembershipContext,
    @Param('invitationId', new ZodValidationPipe(z.uuid())) invitationId: string,
  ): Promise<void> {
    if (!(await this.invitations.revoke(membership.organizationId, invitationId))) {
      throw new NotFoundException({ code: ErrorCode.NotFound, message: 'No such invitation.' });
    }
  }
}
