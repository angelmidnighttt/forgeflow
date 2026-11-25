import { successEnvelope } from '@forgeflow/contracts';
import { z } from 'zod';

const anyEnvelope = successEnvelope(z.unknown());

/**
 * Calls the ForgeFlow API on this origin (the reverse proxy, or the Next rewrite locally, sends
 * /api to the api service) and returns the `data` of its envelope, validated against `schema`.
 */
export async function getData<T extends z.ZodType>(path: string, schema: T): Promise<z.output<T>> {
  const res = await fetch(path, { cache: 'no-store' });
  // Some endpoints, such as /ready, answer a non-2xx status with a body; read it either way.
  const envelope = anyEnvelope.parse(await res.json());
  return schema.parse(envelope.data);
}
