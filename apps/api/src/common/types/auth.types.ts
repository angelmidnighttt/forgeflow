import type { RefreshToken, User } from '@forgeflow/database';
import type { Request } from 'express';

/** Who is calling, read from a verified access token. No database lookup is involved. */
export interface AuthContext {
  userId: string;
  /** The access token's id (`jti`); identifies this token in logs. */
  tokenId: string;
  expiresAt: Date;
}

/** An Express request after JwtAuthGuard ran: `auth` is set when the access token was valid. */
export type AuthenticatedRequest = Request & { auth?: AuthContext };

/** Where a sign-in came from; kept on the refresh token for the list of signed-in devices. */
export interface ClientInfo {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

export interface SignedAccessToken {
  token: string;
  expiresAt: Date;
}

export type AccessTokenCheck =
  { valid: true; auth: AuthContext } | { valid: false; reason: 'expired' | 'invalid' };

/** A refresh token as handed to the client: `secret` goes into the cookie and is never stored. */
export interface IssuedRefreshToken {
  secret: string;
  token: RefreshToken;
}

/**
 * What to do when a refresh token is presented:
 * - `rotate`: valid; replace it with a new token.
 * - `invalid`: expired or signed out.
 * - `conflict`: replaced moments ago, most likely by another tab; the client should retry.
 * - `reuse_detected`: replaced a while ago and presented again, so a copy was stolen.
 */
export type RotationDecision = 'rotate' | 'invalid' | 'conflict' | 'reuse_detected';

export type RotationResult =
  | { status: 'rotated'; userId: string; issued: IssuedRefreshToken }
  /** Unknown, malformed, expired or signed out. */
  | { status: 'invalid' }
  /** Replaced moments ago by a concurrent request; retry with the newer cookie. */
  | { status: 'conflict' }
  /** A replaced token came back after the grace window: the whole sign-in is now revoked. */
  | { status: 'reuse_detected' };

/** What signing in or refreshing hands back to the client. */
export interface IssuedTokens {
  access: SignedAccessToken;
  refresh: IssuedRefreshToken;
  user: User;
}

export type RefreshOutcome =
  | { status: 'refreshed'; tokens: IssuedTokens }
  | { status: 'invalid' | 'conflict' | 'reuse_detected' };

export type RegisterOutcome =
  { status: 'registered'; tokens: IssuedTokens } | { status: 'email_taken' };

/** `invalid_credentials` covers an unknown email, a wrong password and an OAuth-only account. */
export type LoginOutcome =
  { status: 'signed_in'; tokens: IssuedTokens } | { status: 'invalid_credentials' };
