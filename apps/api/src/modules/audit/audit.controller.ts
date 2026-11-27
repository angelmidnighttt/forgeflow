import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import {
  auditLogQuerySchema,
  ErrorCode,
  type AuditLogPage,
  type AuditLogQuery,
} from '@forgeflow/contracts';
import { CurrentMembership } from '../../common/decorators/current-membership.decorator.js';
import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { MembershipContext } from '../../common/types/organization.types.js';
import { AuditService } from './audit.service.js';

@Controller('organizations/:orgId/audit-logs')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** The organization's audit trail, newest first; `?cursor=` from the last page for older ones. */
  @Get()
  @RequirePermission('audit.read')
  async list(
    @CurrentMembership() membership: MembershipContext,
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQuery,
  ): Promise<AuditLogPage> {
    const page = await this.audit.list(membership.organizationId, query);
    if (page === 'invalid_cursor') {
      throw new BadRequestException({
        code: ErrorCode.BadRequest,
        message: 'This cursor is not valid; start again from the first page.',
      });
    }
    return page;
  }
}
