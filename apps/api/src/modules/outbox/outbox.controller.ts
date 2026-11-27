import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ErrorCode, type OutboxEvent } from '@forgeflow/contracts';
import { z } from 'zod';
import { CurrentActor } from '../../common/decorators/current-actor.decorator.js';
import { CurrentMembership } from '../../common/decorators/current-membership.decorator.js';
import { RequirePermission } from '../../common/decorators/require-permission.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuditActor } from '../../common/types/audit.types.js';
import type { MembershipContext } from '../../common/types/organization.types.js';
import { OutboxService } from './outbox.service.js';

/** Background work of the organization that failed for good, and sending it back. */
@Controller('organizations/:orgId/events')
export class OutboxController {
  constructor(@Inject(OutboxService) private readonly outbox: OutboxService) {}

  @Get('dead')
  @RequirePermission('integrations.manage')
  dead(@CurrentMembership() membership: MembershipContext): Promise<OutboxEvent[]> {
    return this.outbox.listDead(membership.organizationId);
  }

  /** Puts a dead event back in the queue with a fresh count of attempts. */
  @Post(':eventId/retry')
  @RequirePermission('integrations.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async retry(
    @CurrentMembership() membership: MembershipContext,
    @CurrentActor() actor: AuditActor,
    @Param('eventId', new ZodValidationPipe(z.uuid())) eventId: string,
  ): Promise<void> {
    if (!(await this.outbox.retry(actor, membership.organizationId, eventId))) {
      throw new NotFoundException({ code: ErrorCode.NotFound, message: 'No such dead event.' });
    }
  }
}
