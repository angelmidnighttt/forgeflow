import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SECRET_TOKEN_BYTES } from '../constants/auth.constants.js';

/** 32 random bytes, base64url-encoded without padding. */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * A new secret token: the value handed to the client (cookie, email link). Used for refresh
 * tokens, email verification and password reset.
 */
export function generateSecretToken(): string {
  return randomBytes(SECRET_TOKEN_BYTES).toString('base64url');
}

/** Cheap format check, so malformed values never reach the database. */
export function isSecretToken(value: string): boolean {
  return SECRET_PATTERN.test(value);
}

/** Only this hash is stored, so a copy of the table cannot be used in place of the token. */
export function hashSecretToken(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** PKCE S256 code challenge for `verifier` (RFC 7636): base64url(SHA-256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Constant-time string comparison, for values an attacker may probe (e.g. OAuth state). */
export function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
