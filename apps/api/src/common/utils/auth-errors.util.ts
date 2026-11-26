import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ErrorCode } from '@forgeflow/contracts';

/** 401 for a request that needs a signed-in user and has none (or one that no longer exists). */
export function signInRequired(): UnauthorizedException {
  return new UnauthorizedException({
    code: ErrorCode.Unauthorized,
    message: 'Sign in to continue.',
  });
}

/** 400 for an emailed link (verify email, reset password) that is unknown, expired or used. */
export function invalidLink(): BadRequestException {
  return new BadRequestException({
    code: ErrorCode.InvalidToken,
    message: 'This link is invalid or has expired. Ask for a new one.',
  });
}
