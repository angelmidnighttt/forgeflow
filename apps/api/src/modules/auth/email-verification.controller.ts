import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ErrorCode, verifyEmailRequestSchema, type VerifyEmailRequest } from '@forgeflow/contracts';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthContext } from '../../common/types/auth.types.js';
import { invalidLink, signInRequired } from '../../common/utils/auth-errors.util.js';
import { EmailVerificationService } from './email-verification.service.js';

@Controller('auth/verify-email')
export class EmailVerificationController {
  constructor(
    @Inject(EmailVerificationService) private readonly emailVerification: EmailVerificationService,
  ) {}

  /**
   * Verifies the email with the token from the link. Public: the link may be opened in a
   * browser that is not signed in; the token alone proves the inbox.
   */
  @Public()
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async verify(
    @Body(new ZodValidationPipe(verifyEmailRequestSchema)) body: VerifyEmailRequest,
  ): Promise<void> {
    if (!(await this.emailVerification.verify(body.token))) throw invalidLink();
  }

  /** Emails a new verification link to the signed-in user; earlier links stop working. */
  @Post('resend')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resend(@CurrentAuth() auth: AuthContext): Promise<void> {
    const outcome = await this.emailVerification.resend(auth.userId);
    switch (outcome) {
      case 'sent':
        return;
      case 'already_verified':
        throw new ConflictException({
          code: ErrorCode.EmailAlreadyVerified,
          message: 'Your email is already verified.',
        });
      case 'send_failed':
        throw new ServiceUnavailableException({
          code: ErrorCode.ServiceUnavailable,
          message: 'The email could not be sent. Try again in a few minutes.',
        });
      case 'unknown_user':
        throw signInRequired();
    }
  }
}
