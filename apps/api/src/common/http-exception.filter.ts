import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ErrorCode, type ErrorBody } from '@forgeflow/contracts';
import type { Request, Response } from 'express';

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BadRequest,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.Unauthorized,
  [HttpStatus.FORBIDDEN]: ErrorCode.Forbidden,
  [HttpStatus.NOT_FOUND]: ErrorCode.NotFound,
  [HttpStatus.CONFLICT]: ErrorCode.Conflict,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RateLimited,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.ServiceUnavailable,
};

/**
 * Turns every thrown error into the shared error envelope:
 * `{ error: { code, message, requestId, details? } }`.
 * Unexpected errors are logged with their stack and returned as a generic 500, never leaking internals.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const requestId = typeof req.id === 'string' ? req.id : undefined;

    const { status, body } = this.toErrorBody(exception, requestId);
    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId },
        exception instanceof Error ? exception.message : 'Unhandled error',
      );
    }
    res.status(status).json(body);
  }

  private toErrorBody(
    exception: unknown,
    requestId: string | undefined,
  ): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const custom =
        typeof response === 'object' && response !== null
          ? (response as { code?: unknown; message?: unknown; details?: unknown })
          : {};
      const code =
        typeof custom.code === 'string'
          ? custom.code
          : (CODE_BY_STATUS[status] ?? ErrorCode.Internal);
      const message =
        typeof custom.message === 'string'
          ? custom.message
          : typeof response === 'string'
            ? response
            : exception.message;
      return {
        status,
        body: {
          error: {
            code,
            message,
            requestId,
            ...(custom.details === undefined ? {} : { details: custom.details }),
          },
        },
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: { code: ErrorCode.Internal, message: 'An unexpected error occurred.', requestId },
      },
    };
  }
}
