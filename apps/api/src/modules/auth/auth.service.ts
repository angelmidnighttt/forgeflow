import { Inject, Injectable } from '@nestjs/common';
import type {
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
  TokenResponse,
} from '@forgeflow/contracts';
import type { DatabaseHandle, User } from '@forgeflow/database';
import { DATABASE } from '../../common/constants/injection-tokens.js';
import { RATE_LIMITS } from '../../common/constants/rate-limit.constants.js';
import type {
  ChangePasswordOutcome,
  ClientInfo,
  IssuedTokens,
  LoginOutcome,
  RefreshOutcome,
  RegisterOutcome,
} from '../../common/types/auth.types.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { toAuthUser, UsersService } from '../users/users.service.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthMailService } from './auth-mail.service.js';
import { EmailVerificationService } from './email-verification.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(AccessTokenService) private readonly accessTokens: AccessTokenService,
    @Inject(RefreshTokenService) private readonly refreshTokens: RefreshTokenService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(EmailVerificationService) private readonly emailVerification: EmailVerificationService,
    @Inject(AuthMailService) private readonly authMail: AuthMailService,
    @Inject(RateLimitService) private readonly rateLimits: RateLimitService,
  ) {}

  /**
   * Creates an email + password account, emails the verification link and signs it in. The
   * email starts unverified. The link is sent in the background, so a slow or unreachable SMTP
   * server never delays or fails the sign-up; the user can ask for a new link.
   */
  async register(input: RegisterRequest, client: ClientInfo = {}): Promise<RegisterOutcome> {
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.users.create({ email: input.email, name: input.name, passwordHash });
    if (!user) return { status: 'email_taken' };
    void this.authMail.trySend('verification', () => this.emailVerification.send(user));
    return { status: 'registered', tokens: await this.issueTokens(user, client) };
  }

  /**
   * Checks email + password and signs the user in. Attempts are counted per email (account or
   * not) since its last successful login; past the limit the email is locked for the rest of
   * the window, even with the right password, and no password is checked.
   */
  async login(input: LoginRequest, client: ClientInfo = {}): Promise<LoginOutcome> {
    const attempt = await this.rateLimits.hit(RATE_LIMITS.loginPerEmail, input.email);
    if (!attempt.allowed) return { status: 'locked', retryAfterSeconds: attempt.retryAfterSeconds };

    const user = await this.users.findByEmail(input.email);
    const passwordOk = await this.passwords.verify(user?.passwordHash, input.password);
    if (!user?.passwordHash || !passwordOk) return { status: 'invalid_credentials' };

    await this.rateLimits.reset(RATE_LIMITS.loginPerEmail, input.email);
    if (this.passwords.needsRehash(user.passwordHash)) {
      await this.users.updatePasswordHash(user.id, await this.passwords.hash(input.password));
    }
    return { status: 'signed_in', tokens: await this.issueTokens(user, client) };
  }

  /**
   * Changes the password of a signed-in user who knows the current one. Every sign-in ends,
   * including the caller's, which gets a fresh one in the returned tokens.
   */
  async changePassword(
    userId: string,
    input: ChangePasswordRequest,
    client: ClientInfo = {},
  ): Promise<ChangePasswordOutcome> {
    const user = await this.users.findById(userId);
    if (!user) return { status: 'unknown_user' };
    if (!user.passwordHash) return { status: 'password_not_set' };
    if (!(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
      return { status: 'invalid_password' };
    }

    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.database.db.transaction(async (tx) => {
      await this.users.updatePasswordHash(user.id, passwordHash, tx);
      await this.refreshTokens.revokeAllForUser(user.id, 'password_changed', { db: tx });
    });
    void this.authMail.trySend('password changed', () => this.authMail.sendPasswordChanged(user));
    return { status: 'changed', tokens: await this.issueTokens(user, client) };
  }

  /** Signs `user` in: starts a refresh token family and issues the first access token. */
  async issueTokens(user: User, client: ClientInfo = {}): Promise<IssuedTokens> {
    const refresh = await this.refreshTokens.create(user.id, client);
    const access = await this.accessTokens.sign(user.id);
    return { access, refresh, user };
  }

  /** Exchanges a refresh token for a new access token and a replacement refresh token. */
  async refresh(secret: string, client: ClientInfo = {}): Promise<RefreshOutcome> {
    const rotation = await this.refreshTokens.rotate(secret, client);
    if (rotation.status !== 'rotated') return { status: rotation.status };
    const user = await this.users.findById(rotation.userId);
    if (!user) return { status: 'invalid' };
    const access = await this.accessTokens.sign(user.id);
    return { status: 'refreshed', tokens: { access, refresh: rotation.issued, user } };
  }

  async signOut(refreshSecret: string): Promise<void> {
    await this.refreshTokens.revokeBySecret(refreshSecret, 'logout');
  }
}

export function toTokenResponse(tokens: IssuedTokens): TokenResponse {
  return {
    accessToken: tokens.access.token,
    tokenType: 'Bearer',
    expiresAt: tokens.access.expiresAt.toISOString(),
    user: toAuthUser(tokens.user),
  };
}
