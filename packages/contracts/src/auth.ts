import { z } from 'zod';

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
