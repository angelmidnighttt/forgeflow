import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '@forgeflow/contracts';

/**
 * 404 for an organization the caller is not a member of, exactly as for one that does not
 * exist: outsiders cannot even tell which organization ids are in use.
 */
export function organizationNotFound(): NotFoundException {
  return new NotFoundException({ code: ErrorCode.NotFound, message: 'Organization not found.' });
}

/** 403 for a member whose role does not allow the action. */
export function roleNotAllowed(
  message = 'Your role in this organization does not allow this.',
): ForbiddenException {
  return new ForbiddenException({ code: ErrorCode.RoleNotAllowed, message });
}

/** 403 for an action that needs a verified email (creating an organization, inviting). */
export function emailNotVerified(): ForbiddenException {
  return new ForbiddenException({
    code: ErrorCode.EmailNotVerified,
    message: 'Verify your email address first.',
  });
}
