import { Inject, Injectable } from '@nestjs/common';
import type { LoginRequest, RegisterRequest, TokenResponse } from '@forgeflow/contracts';
import type { User } from '@forgeflow/database';
import type {
  ClientInfo,
  IssuedTokens,
  LoginOutcome,
  RefreshOutcome,
  RegisterOutcome,
} from '../../common/types/auth.types.js';
import { toAuthUser, UsersService } from '../users/users.service.js';
import { AccessTokenService } from './access-token.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(AccessTokenService) private readonly accessTokens: AccessTokenService,
    @Inject(RefreshTokenService) private readonly refreshTokens: RefreshTokenService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  /** Creates an email + password account and signs it in. The email starts unverified. */
  async register(input: RegisterRequest, client: ClientInfo = {}): Promise<RegisterOutcome> {
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.users.create({ email: input.email, name: input.name, passwordHash });
    if (!user) return { status: 'email_taken' };
    return { status: 'registered', tokens: await this.issueTokens(user, client) };
  }

  /** Checks email + password and signs the user in. */
  async login(input: LoginRequest, client: ClientInfo = {}): Promise<LoginOutcome> {
    const user = await this.users.findByEmail(input.email);
    const passwordOk = await this.passwords.verify(user?.passwordHash, input.password);
    if (!user?.passwordHash || !passwordOk) return { status: 'invalid_credentials' };

    if (this.passwords.needsRehash(user.passwordHash)) {
      await this.users.updatePasswordHash(user.id, await this.passwords.hash(input.password));
    }
    return { status: 'signed_in', tokens: await this.issueTokens(user, client) };
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
