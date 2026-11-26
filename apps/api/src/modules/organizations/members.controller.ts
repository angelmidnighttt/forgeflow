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
  Patch,
} from '@nestjs/common';
import {
  ErrorCode,
  updateMemberRoleRequestSchema,
  type Member,
  type UpdateMemberRoleRequest,
} from '@forgeflow/contracts';
import { z } from 'zod';
import { CurrentMembership } from '../../common/decorators/current-membership.decorator.js';
import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { MembershipContext } from '../../common/types/organization.types.js';
import { roleNotAllowed } from '../../common/utils/organization-errors.util.js';
import { MembershipsService } from './memberships.service.js';

function memberNotFound(): NotFoundException {
  return new NotFoundException({ code: ErrorCode.NotFound, message: 'No such member.' });
}

function lastOwner(): ConflictException {
  return new ConflictException({
    code: ErrorCode.LastOwner,
    message: 'An organization needs at least one owner. Make someone else an owner first.',
  });
}

@Controller('organizations/:orgId/members')
export class MembersController {
  constructor(@Inject(MembershipsService) private readonly memberships: MembershipsService) {}

  @Get()
  @RequirePermission('members.read')
  list(@CurrentMembership() membership: MembershipContext): Promise<Member[]> {
    return this.memberships.list(membership.organizationId);
  }

  /** Changes a member's role. Owners manage everyone; admins manage members and viewers. */
  @Patch(':userId')
  @RequirePermission('members.manage')
  async changeRole(
    @CurrentMembership() membership: MembershipContext,
    @Param('userId', new ZodValidationPipe(z.uuid())) userId: string,
    @Body(new ZodValidationPipe(updateMemberRoleRequestSchema)) body: UpdateMemberRoleRequest,
  ): Promise<Member> {
    const outcome = await this.memberships.changeRole(membership, userId, body.role);
    switch (outcome.status) {
      case 'changed':
        return outcome.member;
      case 'not_found':
        throw memberNotFound();
      case 'role_not_allowed':
        throw roleNotAllowed('Your role cannot change this member to that role.');
      case 'last_owner':
        throw lastOwner();
    }
  }

  /**
   * Removes a member. Removing yourself is leaving the organization, which any member may do
   * (unless they are its only owner).
   */
  @Delete(':userId')
  @RequirePermission('members.read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentMembership() membership: MembershipContext,
    @Param('userId', new ZodValidationPipe(z.uuid())) userId: string,
  ): Promise<void> {
    const outcome = await this.memberships.remove(membership, userId);
    switch (outcome) {
      case 'removed':
        return;
      case 'not_found':
        throw memberNotFound();
      case 'role_not_allowed':
        throw roleNotAllowed('Your role cannot remove this member.');
      case 'last_owner':
        throw lastOwner();
    }
  }
}
