import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  refreshTokens,
  type DatabaseHandle,
  type DbExecutor,
  type RefreshToken,
  type RefreshTokenRevokeReason,
} from '@forgeflow/database';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { MAX_USER_AGENT_LENGTH, TOKEN_POLICY } from '../../common/constants/auth.constants.js';
import { CLOCK, DATABASE } from '../../common/constants/injection-tokens.js';
import type {
  ActiveSession,
  ClientInfo,
  IssuedRefreshToken,
  RotationResult,
} from '../../common/types/auth.types.js';
import type { Clock } from '../../common/types/clock.types.js';
import {
  generateSecretToken,
  hashSecretToken,
  isSecretToken,
} from '../../common/utils/secret-token.util.js';
import { decideRotation, refreshTokenExpiry } from '../../common/utils/token-rotation.util.js';

/**
 * Refresh tokens. Every refresh replaces the token with a new one in the same family; a replaced
 * token that shows up again means a copy was stolen, and the whole family is revoked.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  /** Starts a new family for a fresh sign-in. */
  async create(userId: string, client: ClientInfo = {}): Promise<IssuedRefreshToken> {
    const now = this.now();
    const familyExpiresAt = new Date(now.getTime() + TOKEN_POLICY.refreshAbsoluteMs);
    const { secret, values } = this.newToken(userId, randomUUID(), familyExpiresAt, now, client);
    const [token] = await this.database.db.insert(refreshTokens).values(values).returning();
    if (!token) throw new Error('Refresh token insert returned no row');
    return { secret, token };
  }

  /** Replaces the token behind `secret` with a new one in the same family (one use per token). */
  async rotate(secret: string, client: ClientInfo = {}): Promise<RotationResult> {
    const current = await this.findBySecret(secret);
    if (!current) return { status: 'invalid' };

    const now = this.now();
    const decision = decideRotation(current, now);
    if (decision === 'reuse_detected') {
      await this.revokeFamily(current.familyId, 'reuse_detected');
      return { status: 'reuse_detected' };
    }
    if (decision !== 'rotate') return { status: decision };

    return this.database.db.transaction(async (tx): Promise<RotationResult> => {
      // Only one request can retire a token; a concurrent one finds revoked_at already set.
      const retired = await tx
        .update(refreshTokens)
        .set({ revokedAt: now, revokedReason: 'rotated' })
        .where(and(eq(refreshTokens.id, current.id), isNull(refreshTokens.revokedAt)))
        .returning({ id: refreshTokens.id });
      if (retired.length === 0) return { status: 'conflict' };

      const next = this.newToken(
        current.userId,
        current.familyId,
        current.familyExpiresAt,
        now,
        client,
      );
      const [token] = await tx.insert(refreshTokens).values(next.values).returning();
      if (!token) throw new Error('Refresh token insert returned no row');
      return { status: 'rotated', userId: current.userId, issued: { secret: next.secret, token } };
    });
  }

  /** Ends the sign-in `secret` belongs to, whichever token of the family it is. */
  async revokeBySecret(secret: string, reason: RefreshTokenRevokeReason): Promise<void> {
    const token = await this.findBySecret(secret);
    if (token) await this.revokeFamily(token.familyId, reason);
  }

  async revokeFamily(familyId: string, reason: RefreshTokenRevokeReason): Promise<void> {
    await this.database.db
      .update(refreshTokens)
      .set({ revokedAt: this.now(), revokedReason: reason })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  /**
   * Ends one sign-in of `userId`. Returns false when the family has no live token or belongs to
   * someone else, so a user can never end another user's sign-in by guessing an id.
   */
  async revokeUserFamily(
    userId: string,
    familyId: string,
    reason: RefreshTokenRevokeReason,
  ): Promise<boolean> {
    const revoked = await this.database.db
      .update(refreshTokens)
      .set({ revokedAt: this.now(), revokedReason: reason })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          eq(refreshTokens.familyId, familyId),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .returning({ id: refreshTokens.id });
    return revoked.length > 0;
  }

  /** Ends every sign-in of `userId`, except the family `keepFamilyId` when given. */
  async revokeAllForUser(
    userId: string,
    reason: RefreshTokenRevokeReason,
    options: { keepFamilyId?: string; db?: DbExecutor } = {},
  ): Promise<void> {
    const db = options.db ?? this.database.db;
    await db
      .update(refreshTokens)
      .set({ revokedAt: this.now(), revokedReason: reason })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
          options.keepFamilyId ? ne(refreshTokens.familyId, options.keepFamilyId) : undefined,
        ),
      );
  }

  /**
   * The user's live sign-ins, newest activity first. A live family has exactly one unrevoked,
   * unexpired token: the latest, so its user agent and IP are those of the last refresh.
   */
  async listActiveSessions(userId: string): Promise<ActiveSession[]> {
    const now = this.now();
    // When each family started: its first token. Limited to this user's tokens (indexed).
    const starts = this.database.db
      .select({
        familyId: refreshTokens.familyId,
        signedInAt: sql<Date>`min(${refreshTokens.createdAt})`
          .mapWith(refreshTokens.createdAt)
          .as('signed_in_at'),
      })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, userId))
      .groupBy(refreshTokens.familyId)
      .as('starts');

    return this.database.db
      .select({
        familyId: refreshTokens.familyId,
        userAgent: refreshTokens.userAgent,
        ipAddress: refreshTokens.ipAddress,
        signedInAt: starts.signedInAt,
        lastUsedAt: refreshTokens.createdAt,
        expiresAt: refreshTokens.expiresAt,
      })
      .from(refreshTokens)
      .innerJoin(starts, eq(starts.familyId, refreshTokens.familyId))
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now),
          gt(refreshTokens.familyExpiresAt, now),
        ),
      )
      .orderBy(desc(refreshTokens.createdAt));
  }

  /** The family of the token behind `secret`, if that token is still live. */
  async liveFamilyOf(secret: string): Promise<string | undefined> {
    const token = await this.findBySecret(secret);
    if (!token || token.revokedAt) return undefined;
    return token.familyId;
  }

  private async findBySecret(secret: string): Promise<RefreshToken | undefined> {
    if (!isSecretToken(secret)) return undefined;
    const [token] = await this.database.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashSecretToken(secret)))
      .limit(1);
    return token;
  }

  private newToken(
    userId: string,
    familyId: string,
    familyExpiresAt: Date,
    now: Date,
    client: ClientInfo,
  ) {
    const secret = generateSecretToken();
    return {
      secret,
      values: {
        userId,
        familyId,
        tokenHash: hashSecretToken(secret),
        userAgent: client.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
        ipAddress: client.ipAddress ?? null,
        createdAt: now,
        expiresAt: refreshTokenExpiry(now, familyExpiresAt),
        familyExpiresAt,
      },
    };
  }
}
