import { z } from 'zod';

/** GET /api/v1/health — liveness: the process is up. Never touches dependencies. */
export const healthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeSeconds: z.number().int().nonnegative(),
});
export type Health = z.infer<typeof healthSchema>;

/** GET /api/v1/ready — readiness: the process can serve traffic (dependencies reachable). */
export const readinessSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    database: z.enum(['up', 'down']),
  }),
});
export type Readiness = z.infer<typeof readinessSchema>;
