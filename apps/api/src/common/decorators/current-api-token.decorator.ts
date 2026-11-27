import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ApiTokenContext, ApiTokenRequest } from '../types/api-token.types.js';

/** The project the request's API token acts for. Only on routes guarded by ApiTokenGuard. */
export const CurrentApiToken = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ApiTokenContext => {
    const token = context.switchToHttp().getRequest<ApiTokenRequest>().apiToken;
    if (!token) throw new Error('CurrentApiToken used on a route without ApiTokenGuard');
    return token;
  },
);
