import {
  githubAppSchema,
  githubInstallLinkSchema,
  integrationSchema,
  outboxEventSchema,
  repositorySchema,
  webhookDeliverySchema,
} from '@forgeflow/contracts';
import { z } from 'zod';
import { apiData, apiRequest } from '@/lib/api-client';

const orgPath = (orgId: string) => `/api/v1/organizations/${encodeURIComponent(orgId)}`;

/** The integration endpoints of the API (GitHub App, repositories, webhooks, dead events). */
export const integrationsApi = {
  githubApp: (token: string) =>
    apiData('/api/v1/github/app', githubAppSchema, { accessToken: token }),

  /** Where to send the browser to install the GitHub App (also sets the state cookie). */
  installGithub: (token: string, orgId: string) =>
    apiData(`${orgPath(orgId)}/integrations/github/install`, githubInstallLinkSchema, {
      method: 'POST',
      accessToken: token,
    }),

  list: (token: string, orgId: string) =>
    apiData(`${orgPath(orgId)}/integrations`, z.array(integrationSchema), { accessToken: token }),

  repositories: (token: string, orgId: string, integrationId: string) =>
    apiData(
      `${orgPath(orgId)}/integrations/${encodeURIComponent(integrationId)}/repositories`,
      z.array(repositorySchema),
      { accessToken: token },
    ),

  mapRepository: (token: string, orgId: string, repositoryId: string, projectId: string | null) =>
    apiData(
      `${orgPath(orgId)}/repositories/${encodeURIComponent(repositoryId)}`,
      repositorySchema,
      {
        method: 'PATCH',
        body: { projectId },
        accessToken: token,
      },
    ),

  deliveries: (token: string, orgId: string, integrationId: string) =>
    apiData(
      `${orgPath(orgId)}/integrations/${encodeURIComponent(integrationId)}/deliveries`,
      z.array(webhookDeliverySchema),
      { accessToken: token },
    ),

  deadEvents: (token: string, orgId: string) =>
    apiData(`${orgPath(orgId)}/events/dead`, z.array(outboxEventSchema), { accessToken: token }),

  retryEvent: (token: string, orgId: string, eventId: string) =>
    apiRequest(`${orgPath(orgId)}/events/${encodeURIComponent(eventId)}/retry`, {
      method: 'POST',
      accessToken: token,
    }),
};
