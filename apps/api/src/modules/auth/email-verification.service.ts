import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DatabaseHandle, User } from '@forgeflow/database';
import { CLOCK, DATABASE } from '../../common/constants/injection-tokens.js';
import type { ResendVerificationOutcome } from '../../common/types/auth.types.js';
import type { Clock } from '../../common/types/clock.types.js';
import { UsersService } from '../users/users.service.js';
import { AuthMailService } from './auth-mail.service.js';
import { UserTokenService } from './user-token.service.js';

/** Proving that a user receives mail at their address: a one-time link, valid 24 hours. */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly now: Clock,
    @Inject(UserTokenService) private readonly tokens: UserTokenService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(AuthMailService) private readonly authMail: AuthMailService,
  ) {}

  /** Emails a new verification link; earlier links stop working. Throws if sending fails. */
  async send(user: User): Promise<void> {
    const secret = await this.tokens.issue(user, 'verify_email');
    await this.authMail.sendVerification(user, secret);
  }

  /**
   * Verifies the email the link was sent to. False when the link is unknown, expired, used, or
   * the account's email has changed since it was sent.
   */
  async verify(secret: string): Promise<boolean> {
    return this.database.db.transaction(async (tx) => {
      const token = await this.tokens.consume(secret, 'verify_email', tx);
      if (!token) return false;
      const user = await this.users.findById(token.userId, tx);
      if (!user || user.email !== token.email) return false;
      await this.users.markEmailVerified(user.id, this.now(), tx);
      return true;
    });
  }

  async resend(userId: string): Promise<ResendVerificationOutcome> {
    const user = await this.users.findById(userId);
    if (!user) return 'unknown_user';
    if (user.emailVerifiedAt) return 'already_verified';
    try {
      await this.send(user);
      return 'sent';
    } catch (error) {
      this.logger.error({ err: error }, 'Could not send the verification email');
      return 'send_failed';
    }
  }
}
