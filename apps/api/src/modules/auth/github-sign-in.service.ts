import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseHandle, User } from '@forgeflow/database';
import { CLOCK, DATABASE } from '../../common/constants/injection-tokens.js';
import type { ClientInfo } from '../../common/types/auth.types.js';
import type { Clock } from '../../common/types/clock.types.js';
import type { GithubProfile, GithubSignInOutcome } from '../../common/types/oauth.types.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { UserTokenService } from './user-token.service.js';

/**
 * Turns a GitHub profile into a ForgeFlow sign-in:
 * 1. A user already linked to this GitHub account signs in.
 * 2. Otherwise a user with the same (GitHub-verified) email gets the GitHub account linked.
 * 3. Otherwise a new user is created, email verified, without a password.
 */
@Injectable()
export class GithubSignInService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly now: Clock,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(RefreshTokenService) private readonly refreshTokens: RefreshTokenService,
    @Inject(UserTokenService) private readonly userTokens: UserTokenService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async signIn(
    profile: GithubProfile & { verifiedEmail: string },
    client: ClientInfo = {},
  ): Promise<GithubSignInOutcome> {
    const linked = await this.users.findByOAuthAccount('github', profile.id);
    if (linked) {
      if (linked.account.providerLogin !== profile.login) {
        await this.users.updateOAuthLogin(linked.account.id, profile.login);
      }
      return { status: 'signed_in', tokens: await this.auth.issueTokens(linked.user, client) };
    }

    const user = await this.linkOrCreate(profile);
    if (!user) return { status: 'account_conflict' };
    return { status: 'signed_in', tokens: await this.auth.issueTokens(user, client) };
  }

  private linkOrCreate(profile: GithubProfile & { verifiedEmail: string }) {
    const link = (userId: string) => ({
      userId,
      provider: 'github' as const,
      providerAccountId: profile.id,
      providerLogin: profile.login,
    });

    return this.database.db.transaction(async (tx): Promise<User | undefined> => {
      const now = this.now();
      const existing = await this.users.findByEmail(profile.verifiedEmail, tx);
      if (existing) {
        if (!(await this.users.linkOAuthAccount(link(existing.id), tx))) return undefined;
        if (!existing.emailVerifiedAt) {
          // Whoever signed up with this address never proved they own it; GitHub just proved
          // this user does. Anything the earlier sign-up set up (password, sign-ins, pending
          // links) may belong to someone else, so it goes: this blocks account pre-hijacking.
          await this.users.updatePasswordHash(existing.id, null, tx);
          await this.refreshTokens.revokeAllForUser(existing.id, 'password_changed', { db: tx });
          await this.userTokens.cancelUnused(existing.id, 'reset_password', tx);
          await this.userTokens.cancelUnused(existing.id, 'verify_email', tx);
          await this.users.markEmailVerified(existing.id, now, tx);
          return { ...existing, passwordHash: null, emailVerifiedAt: now };
        }
        return existing;
      }

      const created = await this.users.create(
        {
          email: profile.verifiedEmail,
          name: profile.name || profile.login,
          passwordHash: null,
          emailVerifiedAt: now,
        },
        tx,
      );
      // Taken by a sign-up that committed after the lookup above; the retry links to it.
      if (!created) throw new Error('Email was registered concurrently; retry the sign-in');
      if (!(await this.users.linkOAuthAccount(link(created.id), tx))) {
        throw new Error('GitHub account was linked concurrently; retry the sign-in');
      }
      return created;
    });
  }
}
