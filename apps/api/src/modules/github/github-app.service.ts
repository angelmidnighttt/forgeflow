import { Inject, Injectable } from '@nestjs/common';
import { SignJWT } from 'jose';
import { API_ENV, CLOCK } from '../../common/constants/injection-tokens.js';
import type { Clock } from '../../common/types/clock.types.js';
import type {
  GithubDeployment,
  GithubDeploymentStatus,
  GithubInstallation,
  GithubRepository,
  GithubWorkflowRun,
} from '../../common/types/github.types.js';
import type { ApiEnv } from '../../config/env.js';

const TIMEOUT_MS = 10_000;
/** Pages of 100 read at most when listing (repositories of one installation…). */
const MAX_PAGES = 20;
/** An installation token is reused until this long before it expires. */
const TOKEN_MARGIN_MS = 5 * 60 * 1000;

/** GitHub answered with an error status (or could not be reached: status 0). */
export class GithubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GithubApiError';
  }
}

/** The App's settings when they are all present (see ApiEnv). */
interface AppSettings {
  id: string;
  slug: string;
  privateKey: NonNullable<ApiEnv['GITHUB_APP_PRIVATE_KEY']>;
  clientId: string;
  clientSecret: string;
}

/**
 * The GitHub App's side of GitHub's API: App JWTs (RS256, 9 minutes), installation access
 * tokens (an hour; cached), and the user-to-server OAuth exchange used to check who installed
 * the App. Read-only calls only in Phase 2.
 */
@Injectable()
export class GithubAppService {
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  /** The App's settings, or undefined when this server has no GitHub App. */
  get app(): AppSettings | undefined {
    const e = this.env;
    if (
      !e.GITHUB_APP_ID ||
      !e.GITHUB_APP_SLUG ||
      !e.GITHUB_APP_PRIVATE_KEY ||
      !e.GITHUB_APP_CLIENT_ID ||
      !e.GITHUB_APP_CLIENT_SECRET
    ) {
      return undefined;
    }
    return {
      id: e.GITHUB_APP_ID,
      slug: e.GITHUB_APP_SLUG,
      privateKey: e.GITHUB_APP_PRIVATE_KEY,
      clientId: e.GITHUB_APP_CLIENT_ID,
      clientSecret: e.GITHUB_APP_CLIENT_SECRET,
    };
  }

  /** github.com/apps/<slug>/installations/new, carrying `state` to the setup URL. */
  installUrl(state: string): string {
    const url = new URL(`/apps/${this.requireApp().slug}/installations/new`, this.env.GITHUB_URL);
    url.searchParams.set('state', state);
    return url.toString();
  }

  /** The user-to-server token for the `code` GitHub put on the setup redirect. */
  async exchangeUserCode(code: string): Promise<string> {
    const app = this.requireApp();
    const res = await this.fetch(new URL('/login/oauth/access_token', this.env.GITHUB_URL), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        code,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: unknown };
    if (!res.ok || typeof body.access_token !== 'string') {
      throw new GithubApiError(res.status, 'GitHub refused the authorization code');
    }
    return body.access_token;
  }

  /** The installations of this App that the user behind `userToken` can access. */
  async userInstallations(userToken: string): Promise<GithubInstallation[]> {
    const installations: GithubInstallation[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.get<{ installations: GithubInstallation[] }>(
        `/user/installations?per_page=100&page=${page}`,
        userToken,
      );
      installations.push(...body.installations);
      if (body.installations.length < 100) break;
    }
    return installations;
  }

  async installationRepositories(installationId: string): Promise<GithubRepository[]> {
    const token = await this.installationToken(installationId);
    const repositories: GithubRepository[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.get<{ repositories: GithubRepository[] }>(
        `/installation/repositories?per_page=100&page=${page}`,
        token,
      );
      repositories.push(...body.repositories);
      if (body.repositories.length < 100) break;
    }
    return repositories;
  }

  /** The latest deployments of a repository (one page, newest first). */
  async deployments(installationId: string, fullName: string): Promise<GithubDeployment[]> {
    const token = await this.installationToken(installationId);
    return this.get<GithubDeployment[]>(`/repos/${fullName}/deployments?per_page=30`, token);
  }

  async deploymentStatuses(
    installationId: string,
    fullName: string,
    deploymentId: number,
  ): Promise<GithubDeploymentStatus[]> {
    const token = await this.installationToken(installationId);
    return this.get<GithubDeploymentStatus[]>(
      `/repos/${fullName}/deployments/${deploymentId}/statuses?per_page=30`,
      token,
    );
  }

  /** The latest GitHub Actions runs of a repository (one page, newest first). */
  async workflowRuns(installationId: string, fullName: string): Promise<GithubWorkflowRun[]> {
    const token = await this.installationToken(installationId);
    const body = await this.get<{ workflow_runs: GithubWorkflowRun[] }>(
      `/repos/${fullName}/actions/runs?per_page=30`,
      token,
    );
    return body.workflow_runs;
  }

  /** An installation access token, reused until 5 minutes before it expires. */
  async installationToken(installationId: string): Promise<string> {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expiresAt - TOKEN_MARGIN_MS > this.now().getTime()) return cached.token;

    const res = await this.fetch(
      new URL(`/app/installations/${installationId}/access_tokens`, this.env.GITHUB_API_URL),
      { method: 'POST', headers: this.headers(await this.appJwt()) },
    );
    const body = (await res.json().catch(() => ({}))) as { token?: unknown; expires_at?: unknown };
    if (!res.ok || typeof body.token !== 'string' || typeof body.expires_at !== 'string') {
      throw new GithubApiError(res.status, `No access token for installation ${installationId}`);
    }
    this.tokens.set(installationId, {
      token: body.token,
      expiresAt: Date.parse(body.expires_at),
    });
    return body.token;
  }

  /** Forgets an installation's cached token (it was uninstalled or suspended). */
  forgetInstallation(installationId: string): void {
    this.tokens.delete(installationId);
  }

  /** A JWT that authenticates as the App itself (RS256; issued a minute back for clock skew). */
  private async appJwt(): Promise<string> {
    const app = this.requireApp();
    const now = Math.floor(this.now().getTime() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(app.id)
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 9 * 60)
      .sign(app.privateKey);
  }

  private async get<T>(path: string, token: string): Promise<T> {
    const res = await this.fetch(new URL(path, this.env.GITHUB_API_URL), {
      headers: this.headers(token),
    });
    if (!res.ok) {
      throw new GithubApiError(res.status, `GitHub answered ${res.status} to GET ${path}`);
    }
    return (await res.json()) as T;
  }

  private headers(token: string): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'ForgeFlow',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async fetch(url: URL, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new GithubApiError(0, `GitHub could not be reached: ${(error as Error).message}`);
    }
  }

  private requireApp(): AppSettings {
    const app = this.app;
    if (!app) throw new Error('The GitHub App is not configured (GITHUB_APP_*)');
    return app;
  }
}
