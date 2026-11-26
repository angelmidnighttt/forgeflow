import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@forgeflow/contracts';
import type { Response } from 'express';

/** 429 with Retry-After, so clients know when to try again. */
export function tooManyRequests(
  res: Response,
  retryAfterSeconds: number,
  message = 'Too many requests. Try again later.',
): HttpException {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  return new HttpException(
    { code: ErrorCode.RateLimited, message, details: { retryAfterSeconds } },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
