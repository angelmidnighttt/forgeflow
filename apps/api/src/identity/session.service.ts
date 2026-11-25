import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sessions, users, type DatabaseHandle, type Session } from '@forgeflow/database';
import { eq } from 'drizzle-orm';
import { CLOCK, type Clock } from '../common/clock.js';
import { DATABASE } from '../database/database.module.js';
import type { AuthContext } from './auth-context.js';
import { nextIdleExpiry, SESSION_POLICY } from './session.policy.js';

/** 32 random bytes, base64url-encoded without padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionMeta {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

/** A newly created session. `token` goes into the cookie and is never stored. */
export interface IssuedSession {
  token: string;
  session: Session;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  async create(userId: string, meta: SessionMeta = {}): Promise<IssuedSession> {
    const now = this.now();
    const token = randomToken();
    const absoluteExpiresAt = new Date(now.getTime() + SESSION_POLICY.absoluteLifetimeMs);
    const [session] = await this.database.db
      .insert(sessions)
      .values({
        userId,
        tokenHash: hashSessionToken(token),
        csrfToken: randomToken(),
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
        ipAddress: meta.ipAddress ?? null,
        createdAt: now,
        lastUsedAt: now,
        expiresAt: nextIdleExpiry(now, absoluteExpiresAt),
        absoluteExpiresAt,
      })
      .returning();
    if (!session) throw new Error('Session insert returned no row');
    return { token, session };
  }

  /**
   * Returns who owns `token`, or null when the token is unknown or the session expired.
   * Expired sessions are deleted. Active ones get their idle expiry moved forward,
   * at most once per touch interval.
   */
  async validate(token: string): Promise<AuthContext | null> {
    if (!TOKEN_PATTERN.test(token)) return null;

    const [row] = await this.database.db
      .select({
        session: sessions,
        user: {
          id: users.id,
          email: users.email,
          name: users.name,
          emailVerifiedAt: users.emailVerifiedAt,
        },
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, hashSessionToken(token)))
      .limit(1);
    if (!row) return null;

    const now = this.now();
    let session = row.session;
    if (now >= session.expiresAt || now >= session.absoluteExpiresAt) {
      await this.revoke(session.id);
      return null;
    }

    if (now.getTime() - session.lastUsedAt.getTime() >= SESSION_POLICY.touchIntervalMs) {
      const expiresAt = nextIdleExpiry(now, session.absoluteExpiresAt);
      await this.database.db
        .update(sessions)
        .set({ lastUsedAt: now, expiresAt })
        .where(eq(sessions.id, session.id));
      session = { ...session, lastUsedAt: now, expiresAt };
    }

    return { user: row.user, session };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.database.db.delete(sessions).where(eq(sessions.id, sessionId));
  }
}
