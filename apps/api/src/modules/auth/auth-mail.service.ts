import { Inject, Injectable, Logger } from '@nestjs/common';
import type { User } from '@forgeflow/database';
import { USER_TOKEN_TTL_MS, WEB_PATHS } from '../../common/constants/auth.constants.js';
import { API_ENV } from '../../common/constants/injection-tokens.js';
import { passwordChangedTemplate } from '../../common/templates/password-changed.template.js';
import { resetPasswordTemplate } from '../../common/templates/reset-password.template.js';
import { verifyEmailTemplate } from '../../common/templates/verify-email.template.js';
import type { EmailContent } from '../../common/types/mail.types.js';
import { webLink } from '../../common/utils/web-link.util.js';
import type { ApiEnv } from '../../config/env.js';
import { MailService } from '../mail/mail.service.js';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** The emails of the auth flows: builds the links into the web app and sends the templates. */
@Injectable()
export class AuthMailService {
  private readonly logger = new Logger(AuthMailService.name);

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  async sendVerification(user: User, secret: string): Promise<void> {
    await this.send(
      user,
      verifyEmailTemplate({
        name: user.name,
        url: webLink(this.env.APP_ORIGIN, WEB_PATHS.verifyEmail, secret),
        expiresInHours: USER_TOKEN_TTL_MS.verify_email / HOUR_MS,
      }),
    );
  }

  async sendPasswordReset(user: User, secret: string): Promise<void> {
    await this.send(
      user,
      resetPasswordTemplate({
        name: user.name,
        url: webLink(this.env.APP_ORIGIN, WEB_PATHS.resetPassword, secret),
        expiresInMinutes: USER_TOKEN_TTL_MS.reset_password / MINUTE_MS,
      }),
    );
  }

  async sendPasswordChanged(user: User): Promise<void> {
    await this.send(
      user,
      passwordChangedTemplate({
        name: user.name,
        forgotPasswordUrl: webLink(this.env.APP_ORIGIN, WEB_PATHS.forgotPassword),
      }),
    );
  }

  /**
   * Runs `send` and logs a failure instead of throwing: the flow that triggered the email has
   * already succeeded, and the user can ask for it again. Await it to send before responding;
   * leave it running (`void`) when the response must not depend on the email at all, e.g. when
   * its timing would reveal whether an account exists.
   */
  trySend(what: string, send: () => Promise<void>): Promise<void> {
    return send().catch((error: unknown) => {
      this.logger.error({ err: error }, `Could not send the ${what} email`);
    });
  }

  private async send(user: User, content: EmailContent): Promise<void> {
    await this.mail.send({ to: user.email, ...content });
  }
}
