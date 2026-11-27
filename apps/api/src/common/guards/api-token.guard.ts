import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ErrorCode } from '@forgeflow/contracts';
import type { Response } from 'express';
import { ApiTokensService } from '../../modules/deployments/api-tokens.service.js';
import type { ApiTokenRequest } from '../types/api-token.types.js';

/**
 * Authenticates a pipeline by a project API token (`Authorization: Bearer ffp_…`) on the routes
 * that take one instead of a user's access token (mark them @Public() too). Revoked, expired or
 * unknown tokens get 401 alike.
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(@Inject(ApiTokensService) private readonly tokens: ApiTokensService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<ApiTokenRequest>();
    const header = req.headers.authorization;
    const secret = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    const token = secret ? await this.tokens.authenticate(secret) : undefined;
    if (!token) {
      http.getResponse<Response>().setHeader('WWW-Authenticate', 'Bearer');
      throw new UnauthorizedException({
        code: ErrorCode.Unauthorized,
        message: 'Send a valid API token of the project: Authorization: Bearer ffp_…',
      });
    }
    req.apiToken = token;
    return true;
  }
}
