// Registers ForgeFlow's GitHub App in one click (GitHub's App Manifest flow) and writes its six
// settings where ForgeFlow reads them. Runs on your machine: it opens a local page that sends the
// App's manifest to GitHub; you press "Create GitHub App"; GitHub sends the browser back here
// with a one-time code, which buys the App's ID, private key, webhook secret and OAuth client.
// Nothing secret is printed.
//
// Staging (writes /opt/forgeflow/.env on the server over SSH, root login):
//   npm run github:app -- --origin https://<HOST> --ssh root@<IP> [--deploy]
// Local (GitHub reaches your machine's webhook through a tunnel):
//   npm run github:app -- --origin http://localhost:3000 --env-file .env \
//     --webhook-url https://smee.io/<channel>
//
// Options:
//   --origin <url>       ForgeFlow as browsers reach it (homepage, callback, default webhook)
//   --ssh <user@host>    write the server's .env (with --ssh-port <port> if not 22)
//   --env-file <path>    write a local .env instead
//   --webhook-url <url>  where GitHub sends webhooks (default <origin>/api/v1/webhooks/github)
//   --name <name>        the App's name, unique on GitHub (editable on GitHub's page too)
//   --org <login>        create the App under a GitHub organization, not your account
//   --private            installable only on the account that owns it (default: any account)
//   --deploy             with --ssh: redeploy the running version so it reads the new settings
//   --no-open            print the address to open instead of opening the browser
//   --github-url <url>, --api-url <url>   GitHub Enterprise Server (default github.com)
import { createPrivateKey, randomBytes, sign, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const ENV_KEYS = [
  'GITHUB_APP_ID',
  'GITHUB_APP_SLUG',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_WEBHOOK_SECRET',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
];
/** What every value is made of, so it goes into .env and a quoted heredoc as it is. */
const SAFE_VALUE = /^[A-Za-z0-9+/=._-]+$/;
const SERVER_ENV_FILE = '/opt/forgeflow/.env';
const WAIT_MS = 15 * 60 * 1000;

function fail(message) {
  console.error(`github-app-setup: ${message}`);
  process.exit(1);
}

function httpUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} is not a URL: ${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') fail(`${name} must be http(s)`);
  return url;
}

const isLocalHost = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

/** The App ForgeFlow needs: read-only, with the events it handles. */
export function appManifest({ name, origin, webhookUrl, redirectUrl, isPublic }) {
  const base = origin.replace(/\/$/, '');
  return {
    name,
    url: base,
    description: 'ForgeFlow theo dõi deployment và lần chạy CI của repository (chỉ đọc).',
    hook_attributes: { url: webhookUrl, active: true },
    redirect_url: redirectUrl,
    callback_urls: [`${base}/api/v1/github/setup`],
    // GitHub sends the installer back to the callback URL with a code, which ForgeFlow uses
    // to check the installation is theirs. Updates from GitHub's side need no visit.
    request_oauth_on_install: true,
    setup_on_update: false,
    public: isPublic,
    default_permissions: { deployments: 'read', actions: 'read', metadata: 'read' },
    default_events: ['deployment', 'deployment_status', 'workflow_run'],
  };
}

const escapeHtml = (text) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

function page(title, body) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem}</style>
</head><body>${body}</body></html>`;
}

/** The page that posts the manifest to GitHub (GitHub only accepts it from a form). */
export function manifestPage(action, manifest) {
  return page(
    'Tạo GitHub App cho ForgeFlow',
    `<h1>Tạo GitHub App cho ForgeFlow</h1>
<p>Trang này gửi cấu hình App sang GitHub. Ở GitHub, kiểm tra tên rồi bấm <b>Create GitHub App</b>.</p>
<form id="manifest" method="post" action="${escapeHtml(action)}">
<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
<button type="submit">Tiếp tục sang GitHub</button></form>
<script>document.getElementById('manifest').submit()</script>`,
  );
}

/** A JSON Web Token of the App (RS256), to call the API as the App. */
function appJwt(appId, pem) {
  const now = Math.floor(Date.now() / 1000);
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: now - 60, exp: now + 540, iss: String(appId) })}`;
  const signature = sign('sha256', Buffer.from(unsigned), createPrivateKey(pem));
  return `${unsigned}.${signature.toString('base64url')}`;
}

async function githubApi(apiUrl, path, init) {
  const res = await fetch(new URL(path, apiUrl), {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'forgeflow-github-app-setup',
      'x-github-api-version': '2022-11-28',
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub answered ${res.status} to ${path}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Trades the one-time code for the App's credentials (valid for an hour, no authentication).
 * Should GitHub not have made a webhook secret, one is set through the App's own API.
 */
export async function convertManifest(apiUrl, code) {
  const app = await githubApi(apiUrl, `/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
  });
  let webhookSecret = app.webhook_secret;
  if (!webhookSecret) {
    webhookSecret = randomBytes(32).toString('hex');
    await githubApi(apiUrl, '/app/hook/config', {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${appJwt(app.id, app.pem)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ secret: webhookSecret }),
    });
  }
  const values = {
    GITHUB_APP_ID: String(app.id),
    GITHUB_APP_SLUG: app.slug,
    GITHUB_APP_PRIVATE_KEY: Buffer.from(app.pem).toString('base64'),
    GITHUB_APP_WEBHOOK_SECRET: webhookSecret,
    GITHUB_APP_CLIENT_ID: app.client_id,
    GITHUB_APP_CLIENT_SECRET: app.client_secret,
  };
  for (const key of ENV_KEYS) {
    if (typeof values[key] !== 'string' || !SAFE_VALUE.test(values[key])) {
      throw new Error(`GitHub's answer has no usable ${key}`);
    }
  }
  return { values, name: app.name, htmlUrl: app.html_url, owner: app.owner?.login };
}

/**
 * .env text with the values set: each replaces its `KEY=` line or its commented `# KEY=`
 * placeholder in place (later duplicates go), and the rest is appended.
 */
export function withEnvValues(text, values) {
  const done = new Set();
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const out = [];
  for (const line of lines) {
    const key = /^#?\s*([A-Z0-9_]+)=/.exec(line)?.[1];
    if (key && key in values) {
      if (!done.has(key)) out.push(`${key}=${values[key]}`);
      done.add(key);
      continue;
    }
    out.push(line);
  }
  const rest = Object.keys(values).filter((key) => !done.has(key));
  if (rest.length > 0) {
    out.push(
      '',
      '# GitHub App (npm run github:app)',
      ...rest.map((key) => `${key}=${values[key]}`),
    );
  }
  return `${out.join('\n')}\n`;
}

/**
 * The bash the server runs (stdin of `ssh … bash -s`, so no value shows in a process list):
 * the same update as withEnvValues, written atomically with the file's owner and mode kept.
 */
export function remoteScript(values, { deploy = false } = {}) {
  const assignments = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  return `set -euo pipefail
f=\${FORGEFLOW_ENV_FILE:-${SERVER_ENV_FILE}}
[[ -f $f ]] || { echo "$f not found: is this the ForgeFlow server?" >&2; exit 1; }
umask 077
values=$(mktemp)
next=$(mktemp "$f.XXXXXX")
trap 'rm -f "$values" "$next"' EXIT
cat > "$values" <<'FORGEFLOW_VALUES'
${assignments}
FORGEFLOW_VALUES
awk 'NR == FNR { i = index($0, "="); value[substr($0, 1, i - 1)] = $0; next }
  { key = $0; sub(/^#[[:space:]]*/, "", key); sub(/=.*/, "", key) }
  (key in value) && $0 ~ /^#?[[:space:]]*[A-Z0-9_]+=/ {
    if (!(key in done)) { print value[key]; done[key] = 1 }
    next
  }
  { print }
  END {
    for (key in value) if (!(key in done)) { if (!added++) print "\\n# GitHub App (npm run github:app)"; print value[key] }
  }' "$values" "$f" > "$next"
chown --reference="$f" "$next"
chmod --reference="$f" "$next"
mv "$next" "$f"
echo "Updated $f: ${Object.keys(values).join(', ')}"
${
  deploy
    ? `runuser -u deploy -- bash /opt/forgeflow/repo/infra/staging/scripts/deploy.sh "$(cat /opt/forgeflow/deployed-version)"`
    : ''
}
`;
}

function writeOverSsh(target, port, script) {
  return new Promise((resolve, reject) => {
    const args = [...(port ? ['-p', port] : []), target, 'bash -s'];
    const ssh = spawn('ssh', args, { stdio: ['pipe', 'inherit', 'inherit'] });
    ssh.on('error', reject);
    ssh.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`ssh exited with code ${code}`)),
    );
    ssh.stdin.end(script);
  });
}

function openBrowser(url) {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true })
    .on('error', () => undefined)
    .unref();
}

function sameText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

async function main() {
  const { values: opts } = parseArgs({
    options: {
      origin: { type: 'string' },
      ssh: { type: 'string' },
      'ssh-port': { type: 'string' },
      'env-file': { type: 'string' },
      'webhook-url': { type: 'string' },
      name: { type: 'string' },
      org: { type: 'string' },
      private: { type: 'boolean', default: false },
      deploy: { type: 'boolean', default: false },
      'no-open': { type: 'boolean', default: false },
      'github-url': { type: 'string', default: 'https://github.com' },
      'api-url': { type: 'string', default: 'https://api.github.com' },
    },
  });
  if (!opts.origin) fail('set --origin to the address of ForgeFlow (see the top of this file)');
  if (Boolean(opts.ssh) === Boolean(opts['env-file'])) fail('set one of --ssh or --env-file');
  if (opts.deploy && !opts.ssh) fail('--deploy goes with --ssh');
  if (opts['ssh-port'] && !/^\d+$/.test(opts['ssh-port'])) fail('--ssh-port must be a number');
  if (opts.org && !/^[A-Za-z0-9-]+$/.test(opts.org)) fail('--org must be a GitHub login');
  const origin = httpUrl(opts.origin, '--origin');
  const webhook = httpUrl(
    opts['webhook-url'] ?? `${origin.href.replace(/\/$/, '')}/api/v1/webhooks/github`,
    '--webhook-url',
  );
  if (isLocalHost(webhook)) {
    fail('GitHub cannot reach a webhook on localhost: pass --webhook-url with a tunnel address');
  }
  const githubUrl = httpUrl(opts['github-url'], '--github-url');
  const apiUrl = httpUrl(opts['api-url'], '--api-url');
  const name = opts.name ?? (opts.ssh ? 'ForgeFlow Staging' : 'ForgeFlow Dev');

  const state = randomBytes(24).toString('base64url');
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  let manifest;
  let used = false;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const html = (status, body) => {
      res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(body);
    };
    if (req.method === 'GET' && url.pathname === '/') {
      const path = opts.org ? `/organizations/${opts.org}/settings/apps/new` : '/settings/apps/new';
      const action = new URL(`${path}?state=${state}`, githubUrl).href;
      return html(200, manifestPage(action, manifest));
    }
    if (req.method === 'GET' && url.pathname === '/created') {
      const code = url.searchParams.get('code');
      if (used || !code || !sameText(url.searchParams.get('state') ?? '', state)) {
        return html(
          400,
          page('Không hợp lệ', '<p>Link này không thuộc lần chạy script hiện tại.</p>'),
        );
      }
      used = true;
      html(
        200,
        page(
          'Đã tạo GitHub App',
          '<h1>Đã tạo GitHub App</h1><p>Quay lại terminal: script đang ghi cấu hình.</p>',
        ),
      );
      return resolveDone(code);
    }
    html(404, page('Không có', '<p>Không có trang này.</p>'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  manifest = appManifest({
    name,
    origin: origin.href,
    webhookUrl: webhook.href,
    redirectUrl: `${local}/created`,
    isPublic: !opts.private,
  });
  const timer = setTimeout(
    () => rejectDone(new Error('no answer from GitHub in 15 minutes')),
    WAIT_MS,
  );

  console.log(`Creating the GitHub App "${name}" for ${origin.origin}`);
  console.log(`  webhook  ${webhook.href}`);
  console.log(`  callback ${manifest.callback_urls[0]}`);
  console.log(
    `Open ${local}/ in your browser${opts['no-open'] ? '' : ' (opening it now)'}, then press "Create GitHub App" on GitHub.`,
  );
  if (!opts['no-open']) openBrowser(`${local}/`);

  try {
    const code = await done;
    const app = await convertManifest(apiUrl, code);
    if (opts.ssh) {
      await writeOverSsh(
        opts.ssh,
        opts['ssh-port'],
        remoteScript(app.values, { deploy: opts.deploy }),
      );
    } else {
      const file = opts['env-file'];
      let text = '';
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        // A new file.
      }
      writeFileSync(file, withEnvValues(text, app.values), { mode: 0o600 });
      console.log(`Updated ${file}: ${ENV_KEYS.join(', ')}`);
    }
    console.log(
      `\nGitHub App "${app.name}" created${app.owner ? ` under ${app.owner}` : ''}: ${app.htmlUrl}`,
    );
    if (opts.ssh && !opts.deploy) {
      console.log(
        'Next: deploy again so ForgeFlow reads the settings (infra/staging/README.md, "Đổi .env").',
      );
    } else if (!opts.ssh) {
      console.log('Next: restart npm run dev.');
      if (webhook.hostname === 'smee.io') {
        console.log(
          `  and run: npx smee-client --url ${webhook.href} --target http://localhost:4000/api/v1/webhooks/github`,
        );
      }
    }
    console.log(
      'Then, in ForgeFlow: Tích hợp → Kết nối GitHub (install the App from there, not from GitHub).',
    );
  } catch (error) {
    console.error(`github-app-setup: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
