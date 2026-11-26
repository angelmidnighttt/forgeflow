import { createHash, randomBytes } from 'node:crypto';
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
