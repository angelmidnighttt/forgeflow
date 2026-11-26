import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const FAKE_GITHUB_CLIENT_ID = 'test-client-id';
export const FAKE_GITHUB_CLIENT_SECRET = 'test-client-secret';

export interface FakeGithubAccount {
  id: number;
  login: string;
  name: string | null;
  emails: Array<{ email: string; primary: boolean; verified: boolean }>;
}

interface PendingCode {
  account: FakeGithubAccount;
  codeChallenge: string;
  redirectUri: string;
}

/**
 * A stand-in for github.com and api.github.com: the token endpoint (checking client secret,
 * redirect URI and PKCE like GitHub does), GET /user and GET /user/emails. `approve` plays the
 * user clicking "Authorize" on GitHub's consent page.
 */
export class FakeGithub {
  private readonly codes = new Map<string, PendingCode>();
  private readonly tokens = new Map<string, FakeGithubAccount>();
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

  /**
   * The user approves on the consent page at `authorizeUrl`: returns the `code` and `state` that
   * GitHub would put on the redirect back to the callback.
   */
  approve(authorizeUrl: string, account: FakeGithubAccount): { code: string; state: string } {
    const params = new URL(authorizeUrl).searchParams;
    const code = randomBytes(10).toString('hex');
    this.codes.set(code, {
      account,
      codeChallenge: params.get('code_challenge') ?? '',
      redirectUri: params.get('redirect_uri') ?? '',
    });
    return { code, state: params.get('state') ?? '' };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', this.url).pathname;
    if (req.method === 'POST' && path === '/login/oauth/access_token') {
      const body = JSON.parse(await readBody(req)) as Record<string, string>;
      const pending = this.codes.get(body.code ?? '');
      this.codes.delete(body.code ?? '');
      const verifierOk =
        pending !== undefined &&
        createHash('sha256')
          .update(body.code_verifier ?? '')
          .digest('base64url') === pending.codeChallenge;
      if (
        body.client_id !== FAKE_GITHUB_CLIENT_ID ||
        body.client_secret !== FAKE_GITHUB_CLIENT_SECRET ||
        !pending ||
        body.redirect_uri !== pending.redirectUri ||
        !verifierOk
      ) {
        // GitHub answers 200 with an error body here.
        return send(res, 200, { error: 'bad_verification_code' });
      }
      const token = `gho_${randomBytes(12).toString('hex')}`;
      this.tokens.set(token, pending.account);
      return send(res, 200, { access_token: token, token_type: 'bearer', scope: 'read:user' });
    }

    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    const account = token ? this.tokens.get(token) : undefined;
    if (req.method === 'GET' && (path === '/user' || path === '/user/emails')) {
      if (!account) return send(res, 401, { message: 'Bad credentials' });
      return send(
        res,
        200,
        path === '/user'
          ? { id: account.id, login: account.login, name: account.name }
          : account.emails.map((email) => ({ ...email, visibility: null })),
      );
    }
    send(res, 404, { message: 'Not Found' });
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
