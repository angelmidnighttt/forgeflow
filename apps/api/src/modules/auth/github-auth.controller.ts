import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ErrorCode, OAuthError } from '@forgeflow/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { WEB_PATHS } from '../../common/constants/auth.constants.js';
import { API_ENV } from '../../common/constants/injection-tokens.js';
import { RATE_LIMITS } from '../../common/constants/rate-limit.constants.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { clientInfoFrom } from '../../common/utils/client-info.util.js';
import { generateSecretToken, secretsEqual } from '../../common/utils/secret-token.util.js';
import { webLink } from '../../common/utils/web-link.util.js';
import type { ApiEnv } from '../../config/env.js';
import { AuthService } from './auth.service.js';
import { GithubOAuthService } from './github-oauth.service.js';
import { GithubSignInService } from './github-sign-in.service.js';
import { OAuthStateCookieService } from './oauth-state-cookie.service.js';
import { RefreshCookieService } from './refresh-cookie.service.js';

/** Query of the callback; GitHub sends `code` + `state`, or `error` when the user cancels. */
const callbackQuerySchema = z.object({
  code: z.string().max(256).optional(),
  state: z.string().max(256).optional(),
  error: z.string().max(256).optional(),
});

/**
 * "Sign in with GitHub". Both routes are browser navigations, not API calls: they answer with
 * redirects, and failures send the browser to the web app's login page with `?error=<code>`.
 */
@Controller('auth/github')
export class GithubAuthController {
  private readonly logger = new Logger(GithubAuthController.name);

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(GithubOAuthService) private readonly github: GithubOAuthService,
    @Inject(GithubSignInService) private readonly githubSignIn: GithubSignInService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(OAuthStateCookieService) private readonly stateCookie: OAuthStateCookieService,
    @Inject(RefreshCookieService) private readonly refreshCookie: RefreshCookieService,
  ) {}

  /** Starts the sign-in: remembers a fresh state + PKCE verifier and redirects to GitHub. */
  @Public()
  @RateLimit(RATE_LIMITS.oauthPerIp)
  @Get()
  start(@Res() res: Response): void {
    this.requireEnabled();
    const state = generateSecretToken();
    const codeVerifier = generateSecretToken();
    this.stateCookie.set(res, { state, codeVerifier });
    res.redirect(HttpStatus.FOUND, this.github.authorizeUrl(state, codeVerifier));
  }

  /** GitHub sends the browser back here. Signs in and redirects to the web app. */
  @Public()
  @RateLimit(RATE_LIMITS.oauthPerIp)
  @Get('callback')
  async callback(
    @Query() rawQuery: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    this.requireEnabled();
    const outcome = await this.complete(rawQuery, req, res);
    res.redirect(
      HttpStatus.FOUND,
      outcome === 'signed_in'
        ? webLink(this.env.APP_ORIGIN, WEB_PATHS.home)
        : this.loginError(outcome),
    );
  }

  /** Runs the callback; returns 'signed_in' (refresh cookie set) or why it failed. */
  private async complete(
    rawQuery: unknown,
    req: Request,
    res: Response,
  ): Promise<'signed_in' | OAuthError> {
    // Single use: whatever happens next, this sign-in attempt is over.
    const saved = this.stateCookie.read(req);
    this.stateCookie.clear(res);

    const parsed = callbackQuerySchema.safeParse(rawQuery);
    if (!parsed.success) return OAuthError.Failed;
    const query = parsed.data;
    if (query.error) return query.error === 'access_denied' ? OAuthError.Denied : OAuthError.Failed;
    // The state proves this browser started the sign-in, so nobody can sign a victim into the
    // attacker's account by sending them a callback link (login CSRF).
    if (!saved || !query.state || !secretsEqual(saved.state, query.state)) {
      return OAuthError.StateMismatch;
    }
    if (!query.code) return OAuthError.Failed;

    try {
      const profile = await this.github.profileFor(query.code, saved.codeVerifier);
      if (!profile.verifiedEmail) return OAuthError.EmailUnverified;

      const outcome = await this.githubSignIn.signIn(
        { ...profile, verifiedEmail: profile.verifiedEmail },
        clientInfoFrom(req),
      );
      if (outcome.status === 'account_conflict') return OAuthError.AccountConflict;

      // Same as a password login: the sign-in this browser held before is ended.
      const previous = this.refreshCookie.read(req);
      if (previous) await this.auth.signOut(previous);
      this.refreshCookie.set(res, outcome.tokens.refresh);
      return 'signed_in';
    } catch (error) {
      this.logger.warn({ err: error }, 'GitHub sign-in failed');
      return OAuthError.Failed;
    }
  }

  private loginError(code: OAuthError): string {
    const url = new URL(webLink(this.env.APP_ORIGIN, WEB_PATHS.login));
    url.searchParams.set('error', code);
    return url.toString();
  }

  private requireEnabled(): void {
    if (!this.github.enabled) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Sign in with GitHub is not configured.',
      });
    }
  }
}
