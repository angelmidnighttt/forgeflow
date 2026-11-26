import { errorBodySchema, successEnvelope } from '@forgeflow/contracts';
import { z } from 'zod';

const anyEnvelope = successEnvelope(z.unknown());

/** The API answered with an error envelope: `{ error: { code, message, details? } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    /** From Retry-After, on 429 responses. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The API could not be reached (offline, server down, proxy error without an envelope). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('The ForgeFlow API could not be reached', { cause });
    this.name = 'NetworkError';
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  /** Sent as `Authorization: Bearer <token>`. */
  accessToken?: string;
}

/**
 * Calls the ForgeFlow API on this origin (the reverse proxy, or the Next rewrite locally, sends
 * /api to the api service). Returns the `data` of the success envelope (undefined for 204), or
 * throws ApiError / NetworkError. Cookies go along automatically: the refresh cookie is scoped
 * to /api/v1/auth, so only the auth endpoints ever receive it.
 */
export async function apiRequest(path: string, options: ApiRequestOptions = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch (error) {
    throw new NetworkError(error);
  }

  if (res.status === 204) return undefined;
  const body: unknown = await res.json().catch(() => undefined);
  if (res.ok) return anyEnvelope.parse(body).data;

  const error = errorBodySchema.safeParse(body);
  if (!error.success) throw new NetworkError(new Error(`HTTP ${res.status} without an envelope`));
  const retryAfter = Number(res.headers.get('Retry-After'));
  throw new ApiError(
    res.status,
    error.data.error.code,
    error.data.error.message,
    error.data.error.details,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

/** apiRequest, with the response data validated against `schema`. */
export async function apiData<T extends z.ZodType>(
  path: string,
  schema: T,
  options: ApiRequestOptions = {},
): Promise<z.output<T>> {
  return schema.parse(await apiRequest(path, options));
}

/**
 * GET that reads the envelope whatever the status: some endpoints, such as /ready, answer a
 * non-2xx status with a success body.
 */
export async function getData<T extends z.ZodType>(path: string, schema: T): Promise<z.output<T>> {
  const res = await fetch(path, { cache: 'no-store' });
  const envelope = anyEnvelope.parse(await res.json());
  return schema.parse(envelope.data);
}
