import { z } from 'zod';

export const PROJECT_NAME_MAX_LENGTH = 100;
export const ENVIRONMENT_NAME_MAX_LENGTH = 50;

/** The environments every new project starts with, in order; production starts protected. */
export const DEFAULT_ENVIRONMENTS = [
  { name: 'development', protected: false },
  { name: 'staging', protected: false },
  { name: 'production', protected: true },
] as const;

const projectNameSchema = z.string().trim().min(1, 'Enter a name.').max(PROJECT_NAME_MAX_LENGTH);
const environmentNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(ENVIRONMENT_NAME_MAX_LENGTH);

/**
 * Where a project runs. A protected environment needs approval before ForgeFlow changes it
 * (Phase 6).
 */
export const environmentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  protected: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Environment = z.infer<typeof environmentSchema>;

/** A project with its environments, in display order (development → production). */
export const projectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  environments: z.array(environmentSchema),
  createdAt: z.iso.datetime(),
});
export type Project = z.infer<typeof projectSchema>;

/** POST /api/v1/organizations/:orgId/projects */
export const createProjectRequestSchema = z.object({ name: projectNameSchema });
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

/** PATCH /api/v1/organizations/:orgId/projects/:projectId */
export const updateProjectRequestSchema = z.object({ name: projectNameSchema });
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

/** POST /api/v1/organizations/:orgId/projects/:projectId/environments */
export const createEnvironmentRequestSchema = z.object({
  name: environmentNameSchema,
  protected: z.boolean().default(false),
});
export type CreateEnvironmentRequest = z.infer<typeof createEnvironmentRequestSchema>;

/**
 * PATCH /api/v1/organizations/:orgId/projects/:projectId/environments/:environmentId
 * Renames the environment, protects or unprotects it, or both.
 */
export const updateEnvironmentRequestSchema = z
  .object({ name: environmentNameSchema.optional(), protected: z.boolean().optional() })
  .refine((body) => body.name !== undefined || body.protected !== undefined, {
    message: 'Give a new name, a protected flag, or both.',
  });
export type UpdateEnvironmentRequest = z.infer<typeof updateEnvironmentRequestSchema>;
