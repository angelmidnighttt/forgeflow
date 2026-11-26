import { Inject, Injectable } from '@nestjs/common';
import {
  userTokens,
  type DatabaseHandle,
  type DbExecutor,
  type User,
  type UserToken,
  type UserTokenPurpose,
} from '@forgeflow/database';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { USER_TOKEN_TTL_MS } from '../../common/constants/auth.constants.js';
import { CLOCK, DATABASE } from '../../common/constants/injection-tokens.js';
import type { Clock } from '../../common/types/clock.types.js';
import {
  generateSecretToken,
  hashSecretToken,
  isSecretToken,
} from '../../common/utils/secret-token.util.js';

/**
 * One-time tokens for emailed links (verify email, reset password). Only the hash is stored;
 * issuing a new token for a purpose cancels the user's earlier unused ones for that purpose,
 * so only the latest link works.
 */
@Injectable()
export class UserTokenService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  /** Creates a token for `user` and returns its secret, which goes into the emailed link. */
  async issue(user: User, purpose: UserTokenPurpose): Promise<string> {
    const now = this.now();
    const secret = generateSecretToken();
    await this.database.db.transaction(async (tx) => {
      await this.cancelUnused(user.id, purpose, tx);
      await tx.insert(userTokens).values({
        userId: user.id,
        purpose,
        tokenHash: hashSecretToken(secret),
        email: user.email,
        createdAt: now,
        expiresAt: new Date(now.getTime() + USER_TOKEN_TTL_MS[purpose]),
      });
    });
    return secret;
  }

  /**
   * Marks the token behind `secret` as used and returns it, or undefined when it is unknown,
   * expired, already used or meant for another purpose. A single UPDATE decides, so two
   * requests with the same link cannot both succeed.
   */
  async consume(
    secret: string,
    purpose: UserTokenPurpose,
    db: DbExecutor = this.database.db,
  ): Promise<UserToken | undefined> {
    if (!isSecretToken(secret)) return undefined;
    const now = this.now();
    const [token] = await db
      .update(userTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(userTokens.tokenHash, hashSecretToken(secret)),
          eq(userTokens.purpose, purpose),
          isNull(userTokens.usedAt),
          gt(userTokens.expiresAt, now),
        ),
      )
      .returning();
    return token;
  }

  /** Makes every unused token of `purpose` for the user stop working. */
  async cancelUnused(
    userId: string,
    purpose: UserTokenPurpose,
    db: DbExecutor = this.database.db,
  ): Promise<void> {
    await db
      .delete(userTokens)
      .where(
        and(
          eq(userTokens.userId, userId),
          eq(userTokens.purpose, purpose),
          isNull(userTokens.usedAt),
        ),
      );
  }
}
