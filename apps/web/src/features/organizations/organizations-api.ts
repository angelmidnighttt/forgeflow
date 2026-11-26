import {
  invitationPreviewSchema,
  invitationSchema,
  memberSchema,
  organizationSchema,
  type CreateInvitationRequest,
  type OrganizationRole,
} from '@forgeflow/contracts';
import { z } from 'zod';
import { apiData, apiRequest } from '@/lib/api-client';

const ORGS = '/api/v1/organizations';
const orgPath = (orgId: string) => `${ORGS}/${encodeURIComponent(orgId)}`;

/** The organization endpoints of the API. Errors are ApiError / NetworkError. */
export const organizationsApi = {
  list: (token: string) => apiData(ORGS, z.array(organizationSchema), { accessToken: token }),

  create: (token: string, name: string) =>
    apiData(ORGS, organizationSchema, { method: 'POST', body: { name }, accessToken: token }),

  rename: (token: string, orgId: string, name: string) =>
    apiData(orgPath(orgId), organizationSchema, {
      method: 'PATCH',
      body: { name },
      accessToken: token,
    }),

  members: (token: string, orgId: string) =>
    apiData(`${orgPath(orgId)}/members`, z.array(memberSchema), { accessToken: token }),

  changeRole: (token: string, orgId: string, userId: string, role: OrganizationRole) =>
    apiData(`${orgPath(orgId)}/members/${encodeURIComponent(userId)}`, memberSchema, {
      method: 'PATCH',
      body: { role },
      accessToken: token,
    }),

  /** Removing yourself is leaving the organization. */
  removeMember: (token: string, orgId: string, userId: string) =>
    apiRequest(`${orgPath(orgId)}/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      accessToken: token,
    }),

  invitations: (token: string, orgId: string) =>
    apiData(`${orgPath(orgId)}/invitations`, z.array(invitationSchema), { accessToken: token }),

  invite: (token: string, orgId: string, body: CreateInvitationRequest) =>
    apiData(`${orgPath(orgId)}/invitations`, invitationSchema, {
      method: 'POST',
      body,
      accessToken: token,
    }),

  revokeInvitation: (token: string, orgId: string, invitationId: string) =>
    apiRequest(`${orgPath(orgId)}/invitations/${encodeURIComponent(invitationId)}`, {
      method: 'DELETE',
      accessToken: token,
    }),

  /** What an invitation link offers; no sign-in needed. */
  lookupInvitation: (token: string) =>
    apiData('/api/v1/invitations/lookup', invitationPreviewSchema, {
      method: 'POST',
      body: { token },
    }),

  acceptInvitation: (accessToken: string, token: string) =>
    apiData('/api/v1/invitations/accept', organizationSchema, {
      method: 'POST',
      body: { token },
      accessToken,
    }),
};
