import { z } from 'zod';

/** Password length limits. No composition rules: length is what makes a password strong. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const NAME_MAX_LENGTH = 100;
/** Longest address SMTP can deliver to (RFC 5321). */
export const EMAIL_MAX_LENGTH = 254;

/** Trimmed and lowercased before validation, so `Ann@Example.com ` and `ann@example.com` match. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LENGTH)
  .pipe(z.email({ message: 'Enter a valid email address.' }));

/** A password being set (sign-up, reset, change). Kept exactly as typed, spaces included. */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`);

/**
 * A password being checked (login, current password). Only an upper bound: the length rule is
 * applied when a password is set, and a check must not reveal which rule an old password breaks.
 */
const existingPasswordSchema = z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH);

/** The secret from an emailed link (verify email, reset password). */
const emailedTokenSchema = z.string().trim().min(1, 'The link is incomplete.').max(256);

/** POST /api/v1/auth/register */
export const registerRequestSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  name: z.string().trim().min(1, 'Enter your name.').max(NAME_MAX_LENGTH),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** POST /api/v1/auth/login */
export const loginRequestSchema = z.object({
  email: emailSchema,
  password: existingPasswordSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** POST /api/v1/auth/verify-email: the token from the verification link. */
export const verifyEmailRequestSchema = z.object({ token: emailedTokenSchema });
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

/** POST /api/v1/auth/password/forgot */
export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

/** POST /api/v1/auth/password/reset: the token from the reset link and the new password. */
export const resetPasswordRequestSchema = z.object({
  token: emailedTokenSchema,
  password: newPasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/** POST /api/v1/auth/password/change */
export const changePasswordRequestSchema = z.object({
  currentPassword: existingPasswordSchema,
  newPassword: newPasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** The signed-in user, as returned by the auth endpoints. */
export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().nullable(),
  emailVerified: z.boolean(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

/**
 * Returned when signing in and by POST /api/v1/auth/refresh. Send `accessToken` as
 * `Authorization: Bearer <accessToken>` until `expiresAt`, then call /auth/refresh again.
 * The refresh token itself is never in a response body: it lives in an HttpOnly cookie.
 */
export const tokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  expiresAt: z.iso.datetime(),
  user: authUserSchema,
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

/**
 * One signed-in device (GET /api/v1/auth/sessions). A session starts at login and lasts while
 * its refresh token keeps being refreshed; `userAgent` and `ipAddress` are from the last refresh.
 */
export const sessionSchema = z.object({
  id: z.uuid(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  signedInAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  /** The session of the browser that made this request. */
  current: z.boolean(),
});
export type Session = z.infer<typeof sessionSchema>;
