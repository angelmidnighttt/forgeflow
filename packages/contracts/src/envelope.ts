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
