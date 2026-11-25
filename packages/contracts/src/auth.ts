import { z } from 'zod';

/** Header the browser must send on POST/PUT/PATCH/DELETE when it is signed in. */
export const CSRF_HEADER = 'x-csrf-token';

/** GET /api/v1/auth/session — the signed-in user and the CSRF token for this session. */
export const sessionViewSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    name: z.string().nullable(),
    emailVerified: z.boolean(),
  }),
  session: z.object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  }),
  csrfToken: z.string().min(1),
});
export type SessionView = z.infer<typeof sessionViewSchema>;
