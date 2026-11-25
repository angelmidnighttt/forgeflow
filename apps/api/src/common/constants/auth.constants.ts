import { API_PREFIX } from './http.constants.js';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const JWT_ISSUER = 'forgeflow';
export const JWT_AUDIENCE = 'forgeflow-api';

export const TOKEN_POLICY = {
  /** Access tokens are stateless, so this is also how long a signed-out token keeps working. */
  accessTokenTtlSeconds: 15 * 60,
  /** A refresh token not used for this long stops working. */
  refreshIdleMs: 7 * DAY_MS,
  /** A sign-in ends this long after it started, however often it is refreshed. */
  refreshAbsoluteMs: 30 * DAY_MS,
  /**
   * A refresh token replaced less than this long ago that shows up again is treated as two
   * tabs refreshing at once, not as theft: the request is refused but the sign-in stays valid.
   */
  refreshReuseGraceMs: 30 * 1000,
} as const;

/**
 * argon2id parameters for new password hashes: 19 MiB, 2 passes, 1 lane (the OWASP Password
 * Storage Cheat Sheet baseline). Hashes made with other parameters are upgraded on the next
 * successful login.
 */
export const PASSWORD_HASH_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

/** Random bytes in a refresh token secret (base64url: 43 characters). */
export const REFRESH_TOKEN_BYTES = 32;

/** Longest user agent kept on a refresh token. */
export const MAX_USER_AGENT_LENGTH = 512;

/** Refresh cookie name; the __Secure- variant is used whenever the cookie has the Secure flag. */
export const REFRESH_COOKIE_NAME = 'ff_refresh';
export const SECURE_REFRESH_COOKIE_NAME = '__Secure-ff_refresh';

/** The refresh cookie is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = `/${API_PREFIX}/auth`;

/** Value of the WWW-Authenticate header on 401 responses (RFC 6750). */
export const BEARER_REALM = 'forgeflow';
