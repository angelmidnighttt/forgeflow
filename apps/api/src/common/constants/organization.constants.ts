const DAY_MS = 24 * 60 * 60 * 1000;

/** How long an invitation link works. */
export const INVITATION_TTL_MS = 7 * DAY_MS;

/** How roles are named in emails. */
export const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
} as const;
