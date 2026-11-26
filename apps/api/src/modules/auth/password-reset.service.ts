import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseHandle, User } from '@forgeflow/database';
import { CLOCK, DATABASE } from '../../common/constants/injection-tokens.js';
import { RATE_LIMITS } from '../../common/constants/rate-limit.constants.js';
import type { Clock } from '../../common/types/clock.types.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { UsersService } from '../users/users.service.js';
import { AuthMailService } from './auth-mail.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { UserTokenService } from './user-token.service.js';

/** "Forgot password": a one-time link, valid 1 hour, that lets the user choose a new password. */
@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly now: Clock,
    @Inject(UserTokenService) private readonly tokens: UserTokenService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(RefreshTokenService) private readonly refreshTokens: RefreshTokenService,
    @Inject(AuthMailService) private readonly authMail: AuthMailService,
    @Inject(RateLimitService) private readonly rateLimits: RateLimitService,
  ) {}

  /**
   * Emails a reset link if `email` has an account. Accounts without a password (OAuth only) get
   * one too: resetting is how they add a password. The caller always answers the same way, and
   * the token and email are made in the background, so neither the response nor its timing
   * reveals whether the account exists.
   */
  async requestReset(email: string): Promise<void> {
    // Counted per address whether or not it has an account, and enforced silently: the
    // response stays 204, but nobody can flood an inbox with reset emails.
    const limit = await this.rateLimits.hit(RATE_LIMITS.forgotPasswordPerEmail, email);
    if (!limit.allowed) return;
    const user = await this.users.findByEmail(email);
    if (!user) return;
    void this.authMail.trySend('password reset', async () => {
      const secret = await this.tokens.issue(user, 'reset_password');
      await this.authMail.sendPasswordReset(user, secret);
    });
  }

  /**
   * Sets a new password with the token from a reset link, in one transaction: the token is used
   * up, the password replaced, the email marked verified (the link proved the inbox), every
   * sign-in revoked and any other reset link cancelled. False when the link is not valid.
   */
  async reset(secret: string, password: string): Promise<boolean> {
    const user = await this.database.db.transaction(async (tx): Promise<User | undefined> => {
      const token = await this.tokens.consume(secret, 'reset_password', tx);
      if (!token) return undefined;
      const user = await this.users.findById(token.userId, tx);
      if (!user || user.email !== token.email) return undefined;

      // Hashed only once the link is known to be valid, so bad links cost no CPU.
      await this.users.updatePasswordHash(user.id, await this.passwords.hash(password), tx);
      await this.users.markEmailVerified(user.id, this.now(), tx);
      await this.refreshTokens.revokeAllForUser(user.id, 'password_changed', { db: tx });
      await this.tokens.cancelUnused(user.id, 'reset_password', tx);
      return user;
    });
    if (!user) return false;
    // Whoever reset the password owns the inbox: lift a login lockout an attacker caused.
    await this.rateLimits.reset(RATE_LIMITS.loginPerEmail, user.email);
    void this.authMail.trySend('password changed', () => this.authMail.sendPasswordChanged(user));
    return true;
  }
}
