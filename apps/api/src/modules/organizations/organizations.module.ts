import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { MailModule } from '../mail/mail.module.js';
import { UsersModule } from '../users/users.module.js';
import { InvitationAcceptanceController } from './invitation-acceptance.controller.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { MembersController } from './members.controller.js';
import { MembershipsService } from './memberships.service.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

@Module({
  imports: [UsersModule, MailModule, AuditModule],
  controllers: [
    OrganizationsController,
    MembersController,
    InvitationsController,
    InvitationAcceptanceController,
  ],
  providers: [OrganizationsService, MembershipsService, InvitationsService],
  // OrgPermissionGuard (global, in AppModule) looks memberships up.
  exports: [MembershipsService],
})
export class OrganizationsModule {}
