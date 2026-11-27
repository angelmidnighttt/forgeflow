import { ConflictException, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '@forgeflow/contracts';

/** 404 for a project that does not exist in the route's organization (including other orgs'). */
export function projectNotFound(): NotFoundException {
  return new NotFoundException({ code: ErrorCode.NotFound, message: 'Project not found.' });
}

/** 404 for an environment that is not one of the route's project. */
export function environmentNotFound(): NotFoundException {
  return new NotFoundException({ code: ErrorCode.NotFound, message: 'Environment not found.' });
}

/** 409 for a name already used by a sibling (compared ignoring case). */
export function nameTaken(message: string): ConflictException {
  return new ConflictException({ code: ErrorCode.NameTaken, message, details: { field: 'name' } });
}
