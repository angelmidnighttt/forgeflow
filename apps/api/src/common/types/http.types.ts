import type { Request } from 'express';

/** An Express request after pino-http ran: `id` is the request id from resolveRequestId. */
export type RequestWithId = Request & { id?: unknown };
