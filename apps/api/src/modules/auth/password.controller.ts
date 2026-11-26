import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  changePasswordRequestSchema,
  ErrorCode,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
  type ChangePasswordRequest,
  type ForgotPasswordRequest,
  type ResetPasswordRequest,
  type TokenResponse,
} from '@forgeflow/contracts';
import type { Request, Response } from 'express';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthContext } from '../../common/types/auth.types.js';
import { invalidLink, signInRequired } from '../../common/utils/auth-errors.util.js';
import { clientInfoFrom } from '../../common/utils/client-info.util.js';
import { AuthService, toTokenResponse } from './auth.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { RefreshCookieService } from './refresh-cookie.service.js';

@Controller('auth/password')
export class PasswordController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PasswordResetService) private readonly passwordReset: PasswordResetService,
    @Inject(RefreshCookieService) private readonly cookie: RefreshCookieService,
  ) {}

  /**
   * Emails a reset link if the address has an account. Always 204, so the response never
   * tells whether an account exists.
   */
  @Public()
  @Post('forgot')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgot(
    @Body(new ZodValidationPipe(forgotPasswordRequestSchema)) body: ForgotPasswordRequest,
  ): Promise<void> {
    await this.passwordReset.requestReset(body.email);
  }

  /** Sets a new password with the token from the reset link and signs out every device. */
  @Public()
  @Post('reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reset(
    @Body(new ZodValidationPipe(resetPasswordRequestSchema)) body: ResetPasswordRequest,
  ): Promise<void> {
    if (!(await this.passwordReset.reset(body.token, body.password))) throw invalidLink();
  }

  /**
   * Changes the password of the signed-in user. Every other device is signed out; this one
   * gets a new sign-in (access token in the body, refresh cookie replaced).
   */
  @Post('change')
  @HttpCode(HttpStatus.OK)
  async change(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(changePasswordRequestSchema)) body: ChangePasswordRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    const outcome = await this.auth.changePassword(auth.userId, body, clientInfoFrom(req));
    switch (outcome.status) {
      case 'changed':
        this.cookie.set(res, outcome.tokens.refresh);
        return toTokenResponse(outcome.tokens);
      case 'invalid_password':
        // 400, not 401: the access token is fine, and a 401 would make the client refresh it.
        throw new BadRequestException({
          code: ErrorCode.InvalidPassword,
          message: 'The current password is incorrect.',
        });
      case 'password_not_set':
        throw new ConflictException({
          code: ErrorCode.PasswordNotSet,
          message: 'This account has no password yet. Use "Forgot password" to set one.',
        });
      case 'unknown_user':
        throw signInRequired();
    }
  }
}
