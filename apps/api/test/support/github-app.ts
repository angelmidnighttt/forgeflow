import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { githubSignature } from '../../src/common/utils/webhook-signature.util.js';
import type { ApiEnv } from '../../src/config/env.js';
import { randomIp } from './http.js';

export const GITHUB_APP_ID = '424242';
export const GITHUB_APP_SLUG = 'forgeflow-test';
export const GITHUB_APP_WEBHOOK_SECRET = 'test-only-webhook-secret-0123456789';
export const GITHUB_APP_CLIENT_ID = 'test-app-client-id';
export const GITHUB_APP_CLIENT_SECRET = 'test-app-client-secret';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
/** The public half of the test App's key, for the fake GitHub to verify App JWTs. */
export const GITHUB_APP_PUBLIC_KEY = publicKey;

/** The GitHub App settings for a test app; `githubUrl` points both GitHub URLs at a fake. */
export function githubAppEnv(githubUrl?: string): Partial<ApiEnv> {
  return {
    GITHUB_APP_ID,
    GITHUB_APP_SLUG,
    GITHUB_APP_PRIVATE_KEY: privateKey,
    GITHUB_APP_WEBHOOK_SECRET,
    GITHUB_APP_CLIENT_ID,
    GITHUB_APP_CLIENT_SECRET,
    ...(githubUrl ? { GITHUB_URL: githubUrl, GITHUB_API_URL: githubUrl } : {}),
  };
}

/**
 * POSTs a webhook the way GitHub does: the exact JSON bytes, signed with the webhook secret
 * (unless `signature` overrides it), with X-GitHub-Event and X-GitHub-Delivery.
 */
export function sendGithubWebhook(
  app: INestApplication,
  webhook: {
    event: string;
    body: Record<string, unknown>;
    delivery?: string;
    signature?: string | null;
    secret?: string;
  },
): request.Test {
  const raw = JSON.stringify(webhook.body);
  const signature =
    webhook.signature === undefined
      ? githubSignature(webhook.secret ?? GITHUB_APP_WEBHOOK_SECRET, raw)
      : webhook.signature;
  const req = request(app.getHttpServer())
    .post('/api/v1/webhooks/github')
    .set('X-Forwarded-For', randomIp())
    .set('Content-Type', 'application/json')
    .set('X-GitHub-Event', webhook.event)
    .set('X-GitHub-Delivery', webhook.delivery ?? randomUUID());
  if (signature !== null) req.set('X-Hub-Signature-256', signature);
  return req.send(raw);
}
