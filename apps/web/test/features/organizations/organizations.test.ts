import { describe, expect, it } from '@jest/globals';
import { ORGANIZATION_ROLES } from '@forgeflow/contracts';
import { pickOrganization } from '@/features/organizations/last-organization';
import { assignableRoles, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/features/organizations/roles';

describe('assignableRoles', () => {
  it('follows canAssignRole: owners give any role, admins member and viewer, others none', () => {
    expect(assignableRoles('owner')).toEqual(['owner', 'admin', 'member', 'viewer']);
    expect(assignableRoles('admin')).toEqual(['member', 'viewer']);
    expect(assignableRoles('member')).toEqual([]);
    expect(assignableRoles('viewer')).toEqual([]);
  });

  it('has a Vietnamese label and description for every role', () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
      expect(ROLE_DESCRIPTIONS[role]).toBeTruthy();
    }
  });
});

describe('pickOrganization', () => {
  it('reopens the last organization while the user still belongs to it', () => {
    expect(pickOrganization(['a', 'b'], 'b')).toBe('b');
  });

  it('falls back to the first one, or to none', () => {
    expect(pickOrganization(['a', 'b'], 'gone')).toBe('a');
    expect(pickOrganization(['a', 'b'], null)).toBe('a');
    expect(pickOrganization([], 'a')).toBeUndefined();
  });
});
