import { describe, expect, it } from '@jest/globals';
import { ORGANIZATION_ROLES as CONTRACT_ROLES } from '@forgeflow/contracts';
import { ORGANIZATION_ROLES as DATABASE_ROLES } from '@forgeflow/database';

describe('organization roles', () => {
  it('are the same in the contracts (RBAC) and the database (CHECK constraints)', () => {
    // The database package does not depend on contracts, so the list exists twice.
    expect([...DATABASE_ROLES]).toEqual([...CONTRACT_ROLES]);
  });
});
