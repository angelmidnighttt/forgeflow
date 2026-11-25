import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { REQUEST_ID_HEADER } from '../constants/http.constants.js';

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Reuses an incoming X-Request-Id when it looks safe (so a proxy's id flows through),
 * otherwise generates one. The id is echoed back on the response and attached to every log line.
 */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
