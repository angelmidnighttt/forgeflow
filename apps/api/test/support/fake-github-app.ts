import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { jwtVerify } from 'jose';
import type {
  GithubDeployment,
  GithubDeploymentStatus,
  GithubRepository,
  GithubWorkflowRun,
} from '../../src/common/types/github.types.js';
import {
  GITHUB_APP_CLIENT_ID,
  GITHUB_APP_CLIENT_SECRET,
  GITHUB_APP_ID,
  GITHUB_APP_PUBLIC_KEY,
} from './github-app.js';

interface FakeInstallation {
  account: { login: string; type: string };
  repositories: GithubRepository[];
}

/**
 * A stand-in for github.com / api.github.com as a GitHub App sees them: App JWTs are verified
 * with the test App's public key, installation and user tokens are issued and checked, and the
 * data (installations, repositories, deployments, runs) is whatever the test puts in.
 */
export class FakeGithubApp {
  readonly installations = new Map<number, FakeInstallation>();
  /** Per repository full name. */
  readonly deployments = new Map<
    string,
    Array<{ deployment: GithubDeployment; statuses: GithubDeploymentStatus[] }>
  >();
  readonly runs = new Map<string, GithubWorkflowRun[]>();
  /** "METHOD path" of every request, for assertions. */
  readonly requests: string[] = [];

  private readonly codes = new Map<string, number[]>();
  private readonly userTokens = new Map<string, number[]>();
  private readonly installationTokens = new Map<string, number>();
  private readonly server = createServer((req, res) => {
    this.handle(req, res).catch(() => send(res, 500, { message: 'fake github crashed' }));
  });

  url = '';

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  addInstallation(id: number, login: string, repositories: GithubRepository[] = []): void {
    this.installations.set(id, { account: { login, type: 'Organization' }, repositories });
  }

  /**
   * The user finishes installing on GitHub: returns the `code` GitHub puts on the redirect to the
   * setup URL, for a user who can access `installationIds`.
   */
  authorize(installationIds: number[]): string {
    const code = randomBytes(10).toString('hex');
    this.codes.set(code, installationIds);
    return code;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const path = url.pathname;
    this.requests.push(`${req.method} ${path}`);
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');

    if (req.method === 'POST' && path === '/login/oauth/access_token') {
      const body = JSON.parse(await readBody(req)) as Record<string, string>;
      const installations = this.codes.get(body.code ?? '');
      this.codes.delete(body.code ?? '');
      if (
        body.client_id !== GITHUB_APP_CLIENT_ID ||
        body.client_secret !== GITHUB_APP_CLIENT_SECRET ||
        !installations
      ) {
        return send(res, 200, { error: 'bad_verification_code' });
      }
      const token = `ghu_${randomBytes(12).toString('hex')}`;
      this.userTokens.set(token, installations);
      return send(res, 200, { access_token: token, token_type: 'bearer' });
    }

    const installationToken = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path);
    if (req.method === 'POST' && installationToken) {
      try {
        await jwtVerify(bearer, GITHUB_APP_PUBLIC_KEY, {
          issuer: GITHUB_APP_ID,
          algorithms: ['RS256'],
        });
      } catch {
        return send(res, 401, { message: 'A JSON web token could not be decoded' });
      }
      const id = Number(installationToken[1]);
      if (!this.installations.has(id)) return send(res, 404, { message: 'Not Found' });
      const token = `ghs_${randomBytes(12).toString('hex')}`;
      this.installationTokens.set(token, id);
      return send(res, 201, {
        token,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
    }

    if (req.method === 'GET' && path === '/user/installations') {
      const ids = this.userTokens.get(bearer);
      if (!ids) return send(res, 401, { message: 'Bad credentials' });
      return send(res, 200, {
        total_count: ids.length,
        installations: ids.map((id) => ({
          id,
          account: this.installations.get(id)?.account ?? { login: `account-${id}`, type: 'User' },
        })),
      });
    }

    const installationId = this.installationTokens.get(bearer);
    if (installationId === undefined) return send(res, 401, { message: 'Bad credentials' });
    const installation = this.installations.get(installationId);

    if (req.method === 'GET' && path === '/installation/repositories') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const repositories = page === 1 ? (installation?.repositories ?? []) : [];
      return send(res, 200, { total_count: repositories.length, repositories });
    }
    const statuses = /^\/repos\/([^/]+\/[^/]+)\/deployments\/(\d+)\/statuses$/.exec(path);
    if (req.method === 'GET' && statuses) {
      const entry = (this.deployments.get(statuses[1] ?? '') ?? []).find(
        (d) => d.deployment.id === Number(statuses[2]),
      );
      // Newest first, like GitHub.
      return send(res, 200, [...(entry?.statuses ?? [])].reverse());
    }
    const deployments = /^\/repos\/([^/]+\/[^/]+)\/deployments$/.exec(path);
    if (req.method === 'GET' && deployments) {
      return send(
        res,
        200,
        (this.deployments.get(deployments[1] ?? '') ?? []).map((d) => d.deployment),
      );
    }
    const runs = /^\/repos\/([^/]+\/[^/]+)\/actions\/runs$/.exec(path);
    if (req.method === 'GET' && runs) {
      const list = this.runs.get(runs[1] ?? '') ?? [];
      return send(res, 200, { total_count: list.length, workflow_runs: list });
    }
    return send(res, 404, { message: 'Not Found' });
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
