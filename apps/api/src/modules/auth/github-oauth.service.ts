import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { GITHUB_OAUTH } from '../../common/constants/auth.constants.js';
import { API_ENV } from '../../common/constants/injection-tokens.js';
import type { GithubProfile } from '../../common/types/oauth.types.js';
import { pkceChallenge } from '../../common/utils/secret-token.util.js';
import type { ApiEnv } from '../../config/env.js';

const tokenResponseSchema = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string(), error_description: z.string().optional() }),
]);
const userSchema = z.object({
  id: z.number().int(),
  login: z.string(),
  name: z.string().nullable(),
});
const emailsSchema = z.array(
  z.object({ email: z.string(), primary: z.boolean(), verified: z.boolean() }),
);

/**
 * The GitHub side of "Sign in with GitHub" (OAuth 2.0 authorization code flow with PKCE).
 * Everything GitHub returns is validated; the GitHub access token is used for two profile
 * requests and then dropped.
 */
@Injectable()
export class GithubOAuthService {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  /** False when GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are not set. */
  get enabled(): boolean {
    return this.env.GITHUB_CLIENT_ID !== undefined && this.env.GITHUB_CLIENT_SECRET !== undefined;
  }

  /** GitHub's consent page, which sends the browser back to the callback with a code. */
  authorizeUrl(state: string, codeVerifier: string): string {
    const url = new URL('/login/oauth/authorize', this.env.GITHUB_URL);
    url.search = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: this.callbackUrl(),
      scope: GITHUB_OAUTH.scopes,
      state,
      code_challenge: pkceChallenge(codeVerifier),
      code_challenge_method: 'S256',
      allow_signup: 'true',
    }).toString();
    return url.toString();
  }

  /** Exchanges the code from the callback for the user's GitHub profile. */
  async profileFor(code: string, codeVerifier: string): Promise<GithubProfile> {
    const accessToken = await this.exchangeCode(code, codeVerifier);
    const [user, emails] = await Promise.all([
      this.api('/user', accessToken, userSchema),
      this.api('/user/emails', accessToken, emailsSchema),
    ]);
    const primary = emails.find((email) => email.primary && email.verified);
    return {
      id: String(user.id),
      login: user.login,
      name: user.name,
      verifiedEmail: primary ? primary.email.toLowerCase() : null,
    };
  }

  private async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    const res = await fetch(new URL('/login/oauth/access_token', this.env.GITHUB_URL), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId(),
        client_secret: this.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: this.callbackUrl(),
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(GITHUB_OAUTH.timeoutMs),
    });
    const body = tokenResponseSchema.safeParse(await readJson(res));
    if (!res.ok || !body.success) {
      throw new Error(`Token exchange failed with HTTP ${res.status}`);
    }
    if ('error' in body.data) {
      throw new Error(`Token exchange refused: ${body.data.error}`);
    }
    return body.data.access_token;
  }

  private async api<T>(path: string, accessToken: string, schema: z.ZodType<T>): Promise<T> {
    const res = await fetch(new URL(path, this.env.GITHUB_API_URL), {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'ForgeFlow',
        'X-GitHub-Api-Version': GITHUB_OAUTH.apiVersion,
      },
      signal: AbortSignal.timeout(GITHUB_OAUTH.timeoutMs),
    });
    const body = schema.safeParse(await readJson(res));
    if (!res.ok || !body.success) throw new Error(`GET ${path} failed: ${res.status}`);
    return body.data;
  }

  private clientId(): string {
    if (!this.env.GITHUB_CLIENT_ID) throw new Error('GitHub sign-in is not configured');
    return this.env.GITHUB_CLIENT_ID;
  }

  private callbackUrl(): string {
    return new URL(GITHUB_OAUTH.callbackPath, this.env.APP_ORIGIN).toString();
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}
