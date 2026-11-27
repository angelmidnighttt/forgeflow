import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import {
  ErrorCode,
  invitationTokenRequestSchema,
  type InvitationPreview,
  type InvitationTokenRequest,
  type Organization,
} from '@forgeflow/contracts';
import { RATE_LIMITS } from '../../common/constants/rate-limit.constants.js';
import { CurrentActor } from '../../common/decorators/current-actor.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuditActor } from '../../common/types/audit.types.js';
import { invalidLink } from '../../common/utils/auth-errors.util.js';
import { InvitationsService } from './invitations.service.js';

/** The invitee's side: what a link offers, and accepting it. */
@Controller('invitations')
export class InvitationAcceptanceController {
  constructor(@Inject(InvitationsService) private readonly invitations: InvitationsService) {}

  /**
   * What the invitation behind the token offers (organization, role, invited email), shown
   * before accepting. Public: the invitee may not have an account yet.
   */
  @Public()
  @RateLimit(RATE_LIMITS.emailLinkPerIp)
  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  async lookup(
    @Body(new ZodValidationPipe(invitationTokenRequestSchema)) body: InvitationTokenRequest,
  ): Promise<InvitationPreview> {
    const preview = await this.invitations.preview(body.token);
    if (!preview) throw invalidLink();
    return preview;
  }

  /** Joins the signed-in user to the organization. Their email must be the invited one. */
  @RateLimit(RATE_LIMITS.emailLinkPerIp)
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @CurrentActor() actor: AuditActor,
    @Body(new ZodValidationPipe(invitationTokenRequestSchema)) body: InvitationTokenRequest,
  ): Promise<Organization> {
    const outcome = await this.invitations.accept(actor, body.token);
    switch (outcome.status) {
      case 'accepted':
        return outcome.organization;
      case 'invalid':
        throw invalidLink();
      case 'email_mismatch':
        throw new ForbiddenException({
          code: ErrorCode.InvitationEmailMismatch,
          message: `This invitation was sent to ${outcome.invitedEmail}. Sign in with that email to accept it.`,
          details: { invitedEmail: outcome.invitedEmail },
        });
    }
  }
}
