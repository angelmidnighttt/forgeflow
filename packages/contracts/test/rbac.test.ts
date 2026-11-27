import { describe, expect, it } from '@jest/globals';
import {
  can,
  canAssignRole,
  canManageMember,
  ORGANIZATION_ROLES,
  PERMISSIONS,
  type OrganizationRole,
  type Permission,
} from '../src/rbac.js';

/** The intended matrix, written out: a change to PERMISSIONS must change this test too. */
const EXPECTED: Record<Permission, Record<OrganizationRole, boolean>> = {
  'organization.read': { owner: true, admin: true, member: true, viewer: true },
  'organization.update': { owner: true, admin: true, member: false, viewer: false },
  'members.read': { owner: true, admin: true, member: true, viewer: true },
  'members.manage': { owner: true, admin: true, member: false, viewer: false },
  'invitations.manage': { owner: true, admin: true, member: false, viewer: false },
  'projects.read': { owner: true, admin: true, member: true, viewer: true },
  'projects.manage': { owner: true, admin: true, member: false, viewer: false },
  'environments.protect': { owner: true, admin: true, member: false, viewer: false },
  'audit.read': { owner: true, admin: true, member: false, viewer: false },
  'integrations.read': { owner: true, admin: true, member: true, viewer: true },
  'integrations.manage': { owner: true, admin: true, member: false, viewer: false },
};

describe('can (role × permission)', () => {
  it('covers exactly the permissions of the matrix', () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const permission of Object.keys(EXPECTED) as Permission[]) {
    for (const role of ORGANIZATION_ROLES) {
      const allowed = EXPECTED[permission][role];
      it(`${role} ${allowed ? 'can' : 'cannot'} ${permission}`, () => {
        expect(can(role, permission)).toBe(allowed);
      });
    }
  }
});

describe('canManageMember (actor → target)', () => {
  const MANAGES: Record<OrganizationRole, OrganizationRole[]> = {
    owner: ['owner', 'admin', 'member', 'viewer'],
    admin: ['member', 'viewer'],
    member: [],
    viewer: [],
  };
  for (const actor of ORGANIZATION_ROLES) {
    for (const target of ORGANIZATION_ROLES) {
      const allowed = MANAGES[actor].includes(target);
      it(`${actor} ${allowed ? 'manages' : 'does not manage'} ${target}`, () => {
        expect(canManageMember(actor, target)).toBe(allowed);
      });
    }
  }
});

describe('canAssignRole (actor → role given)', () => {
  const ASSIGNS: Record<OrganizationRole, OrganizationRole[]> = {
    owner: ['owner', 'admin', 'member', 'viewer'],
    admin: ['member', 'viewer'],
    member: [],
    viewer: [],
  };
  for (const actor of ORGANIZATION_ROLES) {
    for (const role of ORGANIZATION_ROLES) {
      const allowed = ASSIGNS[actor].includes(role);
      it(`${actor} ${allowed ? 'can' : 'cannot'} make someone ${role}`, () => {
        expect(canAssignRole(actor, role)).toBe(allowed);
      });
    }
  }
});
