/** Every route is mounted under this prefix. */
export const API_PREFIX = 'api/v1';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Paths that are polled constantly and would only add noise to the request log. */
export const QUIET_PATHS: ReadonlySet<string> = new Set([
  `/${API_PREFIX}/health`,
  `/${API_PREFIX}/ready`,
]);

/** Request and response headers that never reach the logs. */
export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-hub-signature-256"]',
  'res.headers["set-cookie"]',
];

/** Methods that change state; OriginGuard checks where these come from. */
export const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
