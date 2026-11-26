import type { RateLimitRule } from '../types/rate-limit.types.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Limits on the auth endpoints. Per-IP limits slow down scripted attacks without bothering an
 * office behind one NAT address; per-account limits protect one account from many addresses.
 */
export const RATE_LIMITS = {
  /** Every login attempt from one address. */
  loginPerIp: { name: 'login-ip', limit: 30, windowMs: 15 * MINUTE_MS, by: 'ip' },
  /**
   * Login attempts for one email since its last successful login: the temporary lockout. Keyed
   * by the email whether or not it has an account, so a lockout does not reveal that.
   */
  loginPerEmail: { name: 'login-email', limit: 10, windowMs: 15 * MINUTE_MS, by: 'custom' },
  registerPerIp: { name: 'register-ip', limit: 10, windowMs: HOUR_MS, by: 'ip' },
  forgotPasswordPerIp: { name: 'forgot-ip', limit: 10, windowMs: HOUR_MS, by: 'ip' },
  /** Reset emails to one address; beyond it requests still get 204 but nothing is sent. */
  forgotPasswordPerEmail: { name: 'forgot-email', limit: 3, windowMs: HOUR_MS, by: 'custom' },
  /** Using emailed links (verify email, reset password). Tokens are unguessable; this is hygiene. */
  emailLinkPerIp: { name: 'email-link-ip', limit: 30, windowMs: 15 * MINUTE_MS, by: 'ip' },
  resendVerificationPerUser: {
    name: 'verify-resend-user',
    limit: 3,
    windowMs: HOUR_MS,
    by: 'user',
  },
  /** Guards the current-password check against someone holding a stolen access token. */
  changePasswordPerUser: {
    name: 'password-change-user',
    limit: 5,
    windowMs: 15 * MINUTE_MS,
    by: 'user',
  },
  oauthPerIp: { name: 'oauth-ip', limit: 30, windowMs: 15 * MINUTE_MS, by: 'ip' },
  /** Invitation emails one member can send. */
  invitePerUser: { name: 'invite-user', limit: 30, windowMs: HOUR_MS, by: 'user' },
} as const satisfies Record<string, RateLimitRule>;
