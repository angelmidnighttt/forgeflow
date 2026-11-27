import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Whether `header` (X-Hub-Signature-256: "sha256=<hex>") is the HMAC-SHA256 of `body` under
 * `secret`. Compared in constant time; anything malformed is simply false.
 */
export function isValidGithubSignature(
  secret: string,
  body: Buffer,
  header: string | undefined,
): boolean {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The X-Hub-Signature-256 value GitHub would send for `body` (tests, replay script). */
export function githubSignature(secret: string, body: Buffer | string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}
