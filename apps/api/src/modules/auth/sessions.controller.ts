import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ErrorCode, type Session } from '@forgeflow/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthContext } from '../../common/types/auth.types.js';
import { RefreshCookieService } from './refresh-cookie.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

/**
 * The signed-in devices of the current user. A session is one refresh token family: it starts
 * at login and ends at logout, revocation, a password change or its 30-day limit. The refresh
 * cookie (sent to every /auth route) tells which session is this browser's.
 */
@Controller('auth/sessions')
export class SessionsController {
  constructor(
    @Inject(RefreshTokenService) private readonly refreshTokens: RefreshTokenService,
    @Inject(RefreshCookieService) private readonly cookie: RefreshCookieService,
  ) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext, @Req() req: Request): Promise<Session[]> {
    const current = await this.currentFamily(req);
    const sessions = await this.refreshTokens.listActiveSessions(auth.userId);
    return sessions.map((session) => ({
      id: session.familyId,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      signedInAt: session.signedInAt.toISOString(),
      lastUsedAt: session.lastUsedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      current: session.familyId === current,
    }));
  }

  /** Signs out every device except this one. */
  @Post('revoke-others')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOthers(@CurrentAuth() auth: AuthContext, @Req() req: Request): Promise<void> {
    const current = await this.currentFamily(req);
    await this.refreshTokens.revokeAllForUser(auth.userId, 'revoked', { keepFamilyId: current });
  }

  /** Signs out one device. Ending this browser's own session also removes its cookie. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const current = await this.currentFamily(req);
    if (!(await this.refreshTokens.revokeUserFamily(auth.userId, id, 'revoked'))) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'No active session with this id.',
      });
    }
    if (id === current) this.cookie.clear(res);
  }

  private async currentFamily(req: Request): Promise<string | undefined> {
    const secret = this.cookie.read(req);
    return secret ? this.refreshTokens.liveFamilyOf(secret) : undefined;
  }
}
