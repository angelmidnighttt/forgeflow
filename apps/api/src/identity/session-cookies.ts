import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { API_ENV, type ApiEnv } from '../config/env.js';
import type { IssuedSession } from './session.service.js';

/**
 * Reads and writes the two session cookies:
 * - the session cookie (HttpOnly) carries the token that identifies the session;
 * - the CSRF cookie (readable by the page's JavaScript) carries the token the browser must echo
 *   back in the X-CSRF-Token header on state-changing requests.
 * With Secure on, both use the __Host- prefix: the browser then only accepts them over HTTPS,
 * for Path=/ and without a Domain attribute, so no subdomain can set or overwrite them.
 */
@Injectable()
export class SessionCookies {
  readonly secure: boolean;
  readonly sessionName: string;
  readonly csrfName: string;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.secure = env.COOKIE_SECURE ?? env.NODE_ENV === 'production';
    this.sessionName = this.secure ? '__Host-ff_session' : 'ff_session';
    this.csrfName = this.secure ? '__Host-ff_csrf' : 'ff_csrf';
  }

  set(res: Response, issued: IssuedSession): void {
    const options = { ...this.baseOptions(), expires: issued.session.absoluteExpiresAt };
    res.cookie(this.sessionName, issued.token, { ...options, httpOnly: true });
    res.cookie(this.csrfName, issued.session.csrfToken, { ...options, httpOnly: false });
  }

  clear(res: Response): void {
    res.clearCookie(this.sessionName, { ...this.baseOptions(), httpOnly: true });
    res.clearCookie(this.csrfName, { ...this.baseOptions(), httpOnly: false });
  }

  readToken(req: Request): string | undefined {
    const value: unknown = req.cookies?.[this.sessionName];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private baseOptions(): CookieOptions {
    return { secure: this.secure, sameSite: 'lax', path: '/' };
  }
}
