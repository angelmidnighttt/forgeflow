import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '@forgeflow/contracts';

export function integrationNotFound(): NotFoundException {
  return new NotFoundException({ code: ErrorCode.NotFound, message: 'Integration not found.' });
}

export function secretNotFound(): NotFoundException {
  return new NotFoundException({
    code: ErrorCode.NotFound,
    message: 'This integration has no secret with that name.',
  });
}

export function secretValueRequired(): BadRequestException {
  return new BadRequestException({
    code: ErrorCode.BadRequest,
    message: 'This secret is a credential you provide: send its new value.',
  });
}

export function secretValueNotAllowed(): BadRequestException {
  return new BadRequestException({
    code: ErrorCode.BadRequest,
    message: 'ForgeFlow generates this secret: send no value, the new one is in the answer.',
  });
}
