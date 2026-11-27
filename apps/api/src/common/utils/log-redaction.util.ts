/**
 * Query parameters whose values never reach the logs: one-time OAuth codes and states (the
 * GitHub sign-in callback and the GitHub App setup arrive with them), and any token.
 */
export const REDACTED_QUERY_PARAMS: ReadonlySet<string> = new Set([
  'code',
  'state',
  'token',
  'access_token',
  'refresh_token',
  'client_secret',
]);

const CENSOR = '[REDACTED]';
const isSecret = (name: string) => REDACTED_QUERY_PARAMS.has(name.toLowerCase());

/** `url` with the values of secret query parameters replaced; everything else as it was. */
export function redactUrl(url: string | undefined): string | undefined {
  const start = url?.indexOf('?') ?? -1;
  if (!url || start < 0) return url;
  const query = url
    .slice(start + 1)
    .split('&')
    .map((pair) => {
      const name = pair.split('=', 1)[0] ?? '';
      let decoded = name;
      try {
        decoded = decodeURIComponent(name.replace(/\+/g, ' '));
      } catch {
        // A malformed name stays as it is.
      }
      return isSecret(decoded) ? `${name}=${CENSOR}` : pair;
    })
    .join('&');
  return `${url.slice(0, start)}?${query}`;
}

/**
 * The request as pino-http logs it (after the standard serializer: method, url, query,
 * headers…), with secret query parameters censored in both `url` and `query`.
 */
export function redactRequestLog<T extends { url?: string; query?: unknown }>(req: T): T {
  const query =
    req.query && typeof req.query === 'object'
      ? Object.fromEntries(
          Object.entries(req.query).map(([name, value]) => [name, isSecret(name) ? CENSOR : value]),
        )
      : req.query;
  return { ...req, url: redactUrl(req.url), query };
}
