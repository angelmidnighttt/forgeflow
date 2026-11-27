import { z } from 'zod';

export const DEPLOYMENT_STATUSES = [
  'queued',
  'in_progress',
  'success',
  'failure',
  'error',
  'cancelled',
  'inactive',
] as const;
export const deploymentStatusSchema = z.enum(DEPLOYMENT_STATUSES);
export type DeploymentStatus = z.infer<typeof deploymentStatusSchema>;

/** A deployment proper (GitHub Deployments, the report API) or a GitHub Actions run. */
export const DEPLOYMENT_KINDS = ['deployment', 'workflow_run'] as const;
export const deploymentKindSchema = z.enum(DEPLOYMENT_KINDS);

export const deploymentSchema = z.object({
  id: z.uuid(),
  kind: deploymentKindSchema,
  source: z.enum(['github', 'api']),
  /** The project's environment it went to; null for a CI run. */
  environment: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  repository: z.string().nullable(),
  ref: z.string().nullable(),
  sha: z.string().nullable(),
  version: z.string().nullable(),
  status: deploymentStatusSchema,
  description: z.string().nullable(),
  /** Logs or run page. */
  url: z.string().nullable(),
  environmentUrl: z.string().nullable(),
  creator: z.string().nullable(),
  workflow: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  durationSeconds: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Deployment = z.infer<typeof deploymentSchema>;

/** GET /api/v1/organizations/:orgId/projects/:projectId/deployments: newest first. */
export const deploymentPageSchema = z.object({
  deployments: z.array(deploymentSchema),
  nextCursor: z.string().nullable(),
});
export type DeploymentPage = z.infer<typeof deploymentPageSchema>;

export const deploymentQuerySchema = z.object({
  environmentId: z.uuid().optional(),
  status: deploymentStatusSchema.optional(),
  kind: deploymentKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(200).optional(),
});
export type DeploymentQuery = z.infer<typeof deploymentQuerySchema>;

/** What a pipeline may report: every status but `inactive` (GitHub's "superseded"). */
const reportedStatusSchema = z.enum([
  'queued',
  'in_progress',
  'success',
  'failure',
  'error',
  'cancelled',
]);

/**
 * POST /api/v1/deployments, with an API token of the project and an Idempotency-Key header: the
 * same key always yields the same deployment.
 */
export const reportDeploymentRequestSchema = z.object({
  /** The environment's name in the project; a new name adds the environment. */
  environment: z.string().trim().min(1).max(50),
  status: reportedStatusSchema.default('in_progress'),
  version: z.string().trim().min(1).max(100).optional(),
  ref: z.string().trim().min(1).max(255).optional(),
  sha: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/i, 'must be a commit SHA')
    .optional(),
  url: z.httpUrl().max(2000).optional(),
  environmentUrl: z.httpUrl().max(2000).optional(),
  description: z.string().trim().max(500).optional(),
  creator: z.string().trim().min(1).max(100).optional(),
});
export type ReportDeploymentRequest = z.infer<typeof reportDeploymentRequestSchema>;

/** PATCH /api/v1/deployments/:deploymentId: a later status of a reported deployment. */
export const updateReportedDeploymentRequestSchema = z.object({
  status: reportedStatusSchema,
  url: z.httpUrl().max(2000).optional(),
  environmentUrl: z.httpUrl().max(2000).optional(),
  description: z.string().trim().max(500).optional(),
});
export type UpdateReportedDeploymentRequest = z.infer<typeof updateReportedDeploymentRequestSchema>;

/** Idempotency-Key header of the report API. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

/** A project's API token as listed; the secret itself is only in the answer that creates it. */
export const apiTokenSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** The token's first characters ("ffp_AbCd"), to tell tokens apart. */
  prefix: z.string(),
  scopes: z.array(z.string()),
  createdBy: z.object({ name: z.string().nullable(), email: z.email() }).nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});
export type ApiToken = z.infer<typeof apiTokenSchema>;

/** POST /api/v1/organizations/:orgId/projects/:projectId/api-tokens */
export const createApiTokenRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  /** Omit for a token that does not expire. */
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export type CreateApiTokenRequest = z.infer<typeof createApiTokenRequestSchema>;

/** The new token: `secret` is shown this once (`Authorization: Bearer <secret>`). */
export const createdApiTokenSchema = z.object({ token: apiTokenSchema, secret: z.string() });
export type CreatedApiToken = z.infer<typeof createdApiTokenSchema>;
