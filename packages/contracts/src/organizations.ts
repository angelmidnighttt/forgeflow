import { z } from 'zod';
import { emailSchema } from './auth.js';
import { organizationRoleSchema } from './rbac.js';

export const ORGANIZATION_NAME_MAX_LENGTH = 100;

const organizationNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(ORGANIZATION_NAME_MAX_LENGTH);

/** POST /api/v1/organizations */
export const createOrganizationRequestSchema = z.object({ name: organizationNameSchema });
export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequestSchema>;

/** PATCH /api/v1/organizations/:orgId */
export const updateOrganizationRequestSchema = z.object({ name: organizationNameSchema });
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequestSchema>;

/** An organization as seen by one of its members: `role` is the caller's role in it. */
export const organizationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: organizationRoleSchema,
  createdAt: z.iso.datetime(),
});
export type Organization = z.infer<typeof organizationSchema>;

/** GET /api/v1/organizations/:orgId/members */
export const memberSchema = z.object({
  userId: z.uuid(),
  name: z.string().nullable(),
  email: z.email(),
  role: organizationRoleSchema,
  joinedAt: z.iso.datetime(),
});
export type Member = z.infer<typeof memberSchema>;

/** PATCH /api/v1/organizations/:orgId/members/:userId */
export const updateMemberRoleRequestSchema = z.object({ role: organizationRoleSchema });
export type UpdateMemberRoleRequest = z.infer<typeof updateMemberRoleRequestSchema>;

/** POST /api/v1/organizations/:orgId/invitations */
export const createInvitationRequestSchema = z.object({
  email: emailSchema,
  role: organizationRoleSchema,
});
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;

/** A pending invitation, as admins see it. The link itself is only ever in the email. */
export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: organizationRoleSchema,
  invitedBy: z.object({ name: z.string().nullable(), email: z.email() }).nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;

/** The token from an invitation link (POST /api/v1/invitations/lookup and /accept). */
export const invitationTokenRequestSchema = z.object({
  token: z.string().trim().min(1, 'The link is incomplete.').max(256),
});
export type InvitationTokenRequest = z.infer<typeof invitationTokenRequestSchema>;

/** What an invitation link offers, shown before accepting it. */
export const invitationPreviewSchema = z.object({
  organization: z.object({ id: z.uuid(), name: z.string() }),
  email: z.email(),
  role: organizationRoleSchema,
  invitedBy: z.object({ name: z.string().nullable() }).nullable(),
  expiresAt: z.iso.datetime(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
