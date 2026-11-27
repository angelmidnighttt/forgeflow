// Sends a GitHub webhook to a local api, signed with GITHUB_APP_WEBHOOK_SECRET, like GitHub does.
// For trying the GitHub App without GitHub (or a tunnel):
//
//   node scripts/github-webhook-replay.mjs deployment apps/api/test/fixtures/github/deployment.created.json \
//     [--installation 123] [--url http://localhost:4000/api/v1/webhooks/github] [--times 3]
//
// --installation puts that installation id in the payload (one connected to an organization).
// --times sends the same delivery several times (deduplicated by X-GitHub-Delivery).
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    installation: { type: 'string' },
    url: { type: 'string', default: 'http://localhost:4000/api/v1/webhooks/github' },
    times: { type: 'string', default: '1' },
  },
});
const [event, file] = positionals;
if (!event || !file) {
  console.error('usage: node scripts/github-webhook-replay.mjs <event> <payload.json> [options]');
  process.exit(2);
}

function secretFromEnv() {
  if (process.env.GITHUB_APP_WEBHOOK_SECRET) return process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!existsSync('.env')) return undefined;
  const line = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('GITHUB_APP_WEBHOOK_SECRET='));
  return line?.slice('GITHUB_APP_WEBHOOK_SECRET='.length).replace(/^["']|["']$/g, '');
}

const secret = secretFromEnv();
if (!secret) {
  console.error('Set GITHUB_APP_WEBHOOK_SECRET (in the environment or .env).');
  process.exit(2);
}

const payload = JSON.parse(readFileSync(file, 'utf8'));
if (values.installation)
  payload.installation = { ...payload.installation, id: Number(values.installation) };
const body = JSON.stringify(payload);
const delivery = randomUUID();

for (let i = 0; i < Number(values.times); i++) {
  const res = await fetch(values.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': event,
      'X-GitHub-Delivery': delivery,
      'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    body,
  });
  console.log(res.status, await res.text());
}
