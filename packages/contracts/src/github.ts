import { z } from 'zod';

/** GET /api/v1/github/app: whether this server has a GitHub App, and its URL name. */
export const githubAppSchema = z.object({
  configured: z.boolean(),
  slug: z.string().nullable(),
});
export type GithubApp = z.infer<typeof githubAppSchema>;

/** POST /api/v1/organizations/:orgId/integrations/github/install: where to send the browser. */
export const githubInstallLinkSchema = z.object({ url: z.url() });
export type GithubInstallLink = z.infer<typeof githubInstallLinkSchema>;

/**
 * Why connecting the GitHub App failed, as `?github_error=` on the redirect back to the web app:
 * - state: the link expired, or was opened in another browser than the one that started it;
 * - authorization: GitHub sent no user authorization (the App must ask for it on install);
 * - not_yours: the installation is not one the signing-in GitHub user can access;
 * - forbidden: the ForgeFlow user may no longer manage the organization's integrations;
 * - taken: the installation is already connected to another organization;
 * - github: GitHub could not be reached or answered with an error.
 */
export const GITHUB_SETUP_ERRORS = [
  'state',
  'authorization',
  'not_yours',
  'forbidden',
  'taken',
  'github',
] as const;
export type GithubSetupError = (typeof GITHUB_SETUP_ERRORS)[number];

/** A repository a GitHub installation can see, and the project its deployments go to. */
export const repositorySchema = z.object({
  id: z.uuid(),
  integrationId: z.uuid(),
  fullName: z.string(),
  htmlUrl: z.string(),
  defaultBranch: z.string().nullable(),
  private: z.boolean(),
  projectId: z.uuid().nullable(),
  updatedAt: z.iso.datetime(),
});
export type Repository = z.infer<typeof repositorySchema>;

/** PATCH /api/v1/organizations/:orgId/repositories/:repositoryId (null unmaps it). */
export const mapRepositoryRequestSchema = z.object({ projectId: z.uuid().nullable() });
export type MapRepositoryRequest = z.infer<typeof mapRepositoryRequestSchema>;
