import {
  apiTokenSchema,
  createdApiTokenSchema,
  deploymentPageSchema,
  environmentSchema,
  projectSchema,
  type CreateApiTokenRequest,
  type CreateEnvironmentRequest,
  type UpdateEnvironmentRequest,
} from '@forgeflow/contracts';
import { z } from 'zod';
import { apiData, apiRequest } from '@/lib/api-client';

const projectsPath = (orgId: string) =>
  `/api/v1/organizations/${encodeURIComponent(orgId)}/projects`;
const projectPath = (orgId: string, projectId: string) =>
  `${projectsPath(orgId)}/${encodeURIComponent(projectId)}`;

/** The project and environment endpoints of the API. Errors are ApiError / NetworkError. */
export const projectsApi = {
  list: (token: string, orgId: string) =>
    apiData(projectsPath(orgId), z.array(projectSchema), { accessToken: token }),

  get: (token: string, orgId: string, projectId: string) =>
    apiData(projectPath(orgId, projectId), projectSchema, { accessToken: token }),

  /** Comes with development, staging and production (protected). */
  create: (token: string, orgId: string, name: string) =>
    apiData(projectsPath(orgId), projectSchema, {
      method: 'POST',
      body: { name },
      accessToken: token,
    }),

  rename: (token: string, orgId: string, projectId: string, name: string) =>
    apiData(projectPath(orgId, projectId), projectSchema, {
      method: 'PATCH',
      body: { name },
      accessToken: token,
    }),

  addEnvironment: (
    token: string,
    orgId: string,
    projectId: string,
    body: CreateEnvironmentRequest,
  ) =>
    apiData(`${projectPath(orgId, projectId)}/environments`, environmentSchema, {
      method: 'POST',
      body,
      accessToken: token,
    }),

  /** Renames, protects or unprotects an environment (or several of these at once). */
  updateEnvironment: (
    token: string,
    orgId: string,
    projectId: string,
    environmentId: string,
    body: UpdateEnvironmentRequest,
  ) =>
    apiData(
      `${projectPath(orgId, projectId)}/environments/${encodeURIComponent(environmentId)}`,
      environmentSchema,
      { method: 'PATCH', body, accessToken: token },
    ),
};

const deploymentsPath = (orgId: string, projectId: string) =>
  `${projectPath(orgId, projectId)}/deployments`;
const tokensPath = (orgId: string, projectId: string) =>
  `${projectPath(orgId, projectId)}/api-tokens`;

/** A project's deployments and API tokens. */
export const deploymentsApi = {
  list: (
    token: string,
    orgId: string,
    projectId: string,
    query: { environmentId?: string; status?: string; kind?: string; cursor?: string },
  ) => {
    const params = new URLSearchParams(
      Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    const search = params.toString();
    return apiData(
      `${deploymentsPath(orgId, projectId)}${search ? `?${search}` : ''}`,
      deploymentPageSchema,
      { accessToken: token },
    );
  },

  tokens: (token: string, orgId: string, projectId: string) =>
    apiData(tokensPath(orgId, projectId), z.array(apiTokenSchema), { accessToken: token }),

  /** The token's secret is in this answer only. */
  createToken: (token: string, orgId: string, projectId: string, body: CreateApiTokenRequest) =>
    apiData(tokensPath(orgId, projectId), createdApiTokenSchema, {
      method: 'POST',
      body,
      accessToken: token,
    }),

  revokeToken: (token: string, orgId: string, projectId: string, tokenId: string) =>
    apiRequest(`${tokensPath(orgId, projectId)}/${encodeURIComponent(tokenId)}`, {
      method: 'DELETE',
      accessToken: token,
    }),
};
