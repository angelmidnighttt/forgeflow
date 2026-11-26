import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { OAUTH_STATE_COOKIE } from '../../common/constants/auth.constants.js';
import type { OAuthState } from '../../common/types/oauth.types.js';
import { isSecretToken } from '../../common/utils/secret-token.util.js';
import { RefreshCookieService } from './refresh-cookie.service.js';

/**
 * The short-lived cookie that ties an OAuth callback to the browser that started the sign-in
 * (login CSRF protection): it holds the `state` sent to GitHub and the PKCE verifier. HttpOnly,
 * scoped to /api/v1/auth/github, 10 minutes, Secure like the refresh cookie.
 */
@Injectable()
export class OAuthStateCookieService {
  private readonly secure: boolean;
  private readonly name: string;

  constructor(@Inject(RefreshCookieService) refreshCookie: RefreshCookieService) {
    this.secure = refreshCookie.secure;
    this.name = this.secure ? OAUTH_STATE_COOKIE.secureName : OAUTH_STATE_COOKIE.name;
  }

  set(res: Response, value: OAuthState): void {
    res.cookie(this.name, `${value.state}.${value.codeVerifier}`, {
      ...this.options(),
      maxAge: OAUTH_STATE_COOKIE.maxAgeMs,
    });
  }

  /** Reads the cookie; undefined when it is missing, expired or malformed. */
  read(req: Request): OAuthState | undefined {
    const value: unknown = req.cookies?.[this.name];
    if (typeof value !== 'string') return undefined;
    const [state, codeVerifier, ...rest] = value.split('.');
    if (!state || !codeVerifier || rest.length > 0) return undefined;
    if (!isSecretToken(state) || !isSecretToken(codeVerifier)) return undefined;
    return { state, codeVerifier };
  }

  clear(res: Response): void {
    res.clearCookie(this.name, this.options());
  }

  private options(): CookieOptions {
    return { httpOnly: true, secure: this.secure, sameSite: 'lax', path: OAUTH_STATE_COOKIE.path };
  }
}
