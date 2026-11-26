import { z } from 'zod';

/** Stable, machine-readable error codes returned in every error envelope. */
export const ErrorCode = {
  ValidationFailed: 'VALIDATION_FAILED',
  BadRequest: 'BAD_REQUEST',
  Unauthorized: 'UNAUTHORIZED',
  /** The access token expired: call POST /api/v1/auth/refresh, then retry. */
  TokenExpired: 'TOKEN_EXPIRED',
  /** Login failed. Deliberately does not say whether the email or the password was wrong. */
  InvalidCredentials: 'INVALID_CREDENTIALS',
  /** Registration with an email that already has an account. */
  EmailTaken: 'EMAIL_TAKEN',
  /** A verification or password reset link that is unknown, expired or already used. */
  InvalidToken: 'INVALID_TOKEN',
  /** The current password given to change the password is wrong. */
  InvalidPassword: 'INVALID_PASSWORD',
  /** The account has no password yet (it signs in through OAuth); use "forgot password" to set one. */
  PasswordNotSet: 'PASSWORD_NOT_SET',
  EmailAlreadyVerified: 'EMAIL_ALREADY_VERIFIED',
  /** The action needs a verified email (creating an organization, inviting people). */
  EmailNotVerified: 'EMAIL_NOT_VERIFIED',
  /** The caller's role in the organization does not allow the action. */
  RoleNotAllowed: 'ROLE_NOT_ALLOWED',
  /** The change would leave the organization without an owner. */
  LastOwner: 'LAST_OWNER',
  /** The invited email already belongs to a member of the organization. */
  AlreadyMember: 'ALREADY_MEMBER',
  /** The invitation was sent to another email than the signed-in user's. */
  InvitationEmailMismatch: 'INVITATION_EMAIL_MISMATCH',
  Forbidden: 'FORBIDDEN',
  /** A state-changing request came from another site (CSRF protection). */
  OriginNotAllowed: 'ORIGIN_NOT_ALLOWED',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  RateLimited: 'RATE_LIMITED',
  ServiceUnavailable: 'SERVICE_UNAVAILABLE',
  Internal: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

/** Every successful response is wrapped as `{ data: ... }`. */
export function successEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ data });
}
export interface SuccessBody<T> {
  data: T;
}
