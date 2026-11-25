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

/** POST /api/v1/auth/register */
export const registerRequestSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`),
  name: z.string().trim().min(1, 'Enter your name.').max(NAME_MAX_LENGTH),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/**
 * POST /api/v1/auth/login. The password only gets an upper bound here: the length rule is
 * checked when a password is set, and a login must not reveal which rule an old password breaks.
 */
export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

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
