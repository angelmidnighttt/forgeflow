import { createHash, randomBytes } from 'node:crypto';
import { REFRESH_TOKEN_BYTES } from '../constants/auth.constants.js';

/** 32 random bytes, base64url-encoded without padding: the value that goes into the cookie. */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateRefreshTokenSecret(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/** Cheap format check, so malformed cookies never reach the database. */
export function isRefreshTokenSecret(value: string): boolean {
  return SECRET_PATTERN.test(value);
}

/** Only this hash is stored, so a copy of the table cannot be used to sign in. */
export function hashRefreshTokenSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
