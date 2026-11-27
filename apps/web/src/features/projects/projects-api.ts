import {
  environmentSchema,
  projectSchema,
  type CreateEnvironmentRequest,
  type UpdateEnvironmentRequest,
} from '@forgeflow/contracts';
import { z } from 'zod';
import { apiData } from '@/lib/api-client';

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
