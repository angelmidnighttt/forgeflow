import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  SECURE_REFRESH_COOKIE_NAME,
} from '../../common/constants/auth.constants.js';
import { API_ENV } from '../../common/constants/injection-tokens.js';
import type { IssuedRefreshToken } from '../../common/types/auth.types.js';
import type { ApiEnv } from '../../config/env.js';

/**
 * The refresh token cookie: HttpOnly (page scripts cannot read it), SameSite=Strict (never sent
 * on requests started by another site) and scoped to /api/v1/auth. With Secure on it uses the
 * __Secure- prefix, so the browser only accepts it over HTTPS.
 */
@Injectable()
export class RefreshCookieService {
  readonly secure: boolean;
  readonly name: string;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.secure = env.COOKIE_SECURE ?? env.NODE_ENV === 'production';
    this.name = this.secure ? SECURE_REFRESH_COOKIE_NAME : REFRESH_COOKIE_NAME;
  }

  set(res: Response, issued: IssuedRefreshToken): void {
    res.cookie(this.name, issued.secret, { ...this.options(), expires: issued.token.expiresAt });
  }

  clear(res: Response): void {
    res.clearCookie(this.name, this.options());
  }

  read(req: Request): string | undefined {
    const value: unknown = req.cookies?.[this.name];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private options(): CookieOptions {
    return { httpOnly: true, secure: this.secure, sameSite: 'strict', path: REFRESH_COOKIE_PATH };
  }
}
