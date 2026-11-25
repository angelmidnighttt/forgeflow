import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { ErrorCode } from '@forgeflow/contracts';
import type { z } from 'zod';
import type { ValidationIssue } from '../types/validation.types.js';

/**
 * Validates a request part (body, query, params) with a zod schema from @forgeflow/contracts.
 * Usage: `@Body(new ZodValidationPipe(createProjectSchema)) body: CreateProject`
 */
@Injectable()
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Request validation failed.',
      details: issues,
    });
  }
}
