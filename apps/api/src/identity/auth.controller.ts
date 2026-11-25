import { Controller, Get, HttpCode, HttpStatus, Inject, Post, Res } from '@nestjs/common';
import type { SessionView } from '@forgeflow/contracts';
import type { Response } from 'express';
import type { AuthContext } from './auth-context.js';
import { CurrentAuth } from './auth.decorators.js';
import { SessionCookies } from './session-cookies.js';
import { SessionService } from './session.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SessionCookies) private readonly cookies: SessionCookies,
  ) {}

  /** The signed-in user, the session's expiry and the CSRF token for this session. */
  @Get('session')
  session(@CurrentAuth() auth: AuthContext): SessionView {
    const { user, session } = auth;
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerifiedAt !== null,
      },
      session: {
        id: session.id,
        createdAt: session.createdAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      },
      csrfToken: session.csrfToken,
    };
  }

  /** Ends this session on the server and removes both cookies. */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.revoke(auth.session.id);
    this.cookies.clear(res);
  }
}
