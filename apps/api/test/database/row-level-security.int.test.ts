import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  createDatabase,
  environments,
  invitations,
  memberships,
  organizations,
  projects,
  roleBypassesRowLevelSecurity,
  type DatabaseHandle,
  type User,
} from '@forgeflow/database';
import { eq, sql } from 'drizzle-orm';
import { hashSecretToken } from '../../src/common/utils/secret-token.util.js';
import {
  createUser,
  pgErrorCode,
  testDatabaseUrl,
  testOwnerDatabaseUrl,
} from '../support/test-database.js';

/**
 * Row-level security as the api's role (forgeflow_app) sees it, with the application filters
 * deliberately left out: PostgreSQL alone must keep tenants apart (docs/adr/ADR-0002).
 * Fixtures are written with the owner connection, which bypasses RLS.
 */
let owner: DatabaseHandle;
let app: DatabaseHandle;

let orgA: string;
let orgB: string;
let alice: User; // owner of A, viewer of B
let bob: User; // owner of B only
let tokenB: string;

beforeAll(async () => {
  owner = createDatabase(testOwnerDatabaseUrl(), { max: 2 });
  // One connection, so the "no leak between transactions" test reuses the same session.
  app = createDatabase(testDatabaseUrl(), { max: 1 });

  orgA = randomUUID();
  orgB = randomUUID();
  await owner.db.insert(organizations).values([
    { id: orgA, name: 'RLS A' },
    { id: orgB, name: 'RLS B' },
  ]);
  alice = await createUser(owner.db);
  bob = await createUser(owner.db);
  await owner.db.insert(memberships).values([
    { organizationId: orgA, userId: alice.id, role: 'owner' },
    { organizationId: orgB, userId: alice.id, role: 'viewer' },
    { organizationId: orgB, userId: bob.id, role: 'owner' },
  ]);
  tokenB = randomBytes(32).toString('base64url');
  const invite = (organizationId: string, token: string) => ({
    organizationId,
    email: `${randomUUID()}@example.test`,
    role: 'member' as const,
    tokenHash: hashSecretToken(token),
    expiresAt: new Date(Date.now() + 60_000),
  });
  await owner.db
    .insert(invitations)
    .values([invite(orgA, randomBytes(32).toString('base64url')), invite(orgB, tokenB)]);
});

afterAll(async () => {
  await app.close();
  await owner.db.delete(organizations).where(eq(organizations.id, orgA));
  await owner.db.delete(organizations).where(eq(organizations.id, orgB));
  await owner.close();
});

describe('the api role', () => {
  it('is not a superuser, has no BYPASSRLS and owns no table', async () => {
    expect(await roleBypassesRowLevelSecurity(app.pool)).toBe(false);
    const role = await owner.pool.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'forgeflow_app'`,
    );
    expect(role.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    const owned = await owner.pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'forgeflow_app'`,
    );
    expect(owned.rows).toEqual([]);
  });
});

describe('every tenant table', () => {
  it('has row-level security enabled and forced, with policies', async () => {
    const tables = await owner.pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: number;
    }>(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND (c.relname = 'organizations' OR EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public' AND col.table_name = c.relname
            AND col.column_name = 'organization_id'))
      ORDER BY c.relname`);

    expect(tables.rows.map((t) => t.relname)).toEqual(
      expect.arrayContaining([
        'environments',
        'invitations',
        'memberships',
        'organizations',
        'projects',
      ]),
    );
    for (const table of tables.rows) {
      expect({
        table: table.relname,
        rls: table.relrowsecurity,
        forced: table.relforcerowsecurity,
      }).toEqual({ table: table.relname, rls: true, forced: true });
      expect(table.policies).toBeGreaterThan(0);
    }
  });
});

describe('reading', () => {
  it('without a tenant context returns no rows at all', async () => {
    expect(await app.db.select().from(organizations)).toEqual([]);
    expect(await app.db.select().from(memberships)).toEqual([]);
    expect(await app.db.select().from(invitations)).toEqual([]);
  });

  it("in an organization's context returns only that organization's rows", async () => {
    const rows = await app.withTenant({ organizationId: orgA }, async (tx) => ({
      organizations: await tx.select().from(organizations),
      memberships: await tx.select().from(memberships),
      invitations: await tx.select().from(invitations),
    }));

    expect(rows.organizations.map((o) => o.id)).toEqual([orgA]);
    expect(rows.memberships.map((m) => [m.organizationId, m.userId])).toEqual([[orgA, alice.id]]);
    expect(rows.invitations.map((i) => i.organizationId)).toEqual([orgA]);
  });

  it("in a user's context returns their own memberships and organizations, in every organization", async () => {
    const forAlice = await app.withTenant({ userId: alice.id }, async (tx) => ({
      memberships: await tx.select().from(memberships),
      organizations: await tx.select().from(organizations),
      invitations: await tx.select().from(invitations),
    }));
    expect(forAlice.memberships.map((m) => [m.organizationId, m.role]).sort()).toEqual(
      [
        [orgA, 'owner'],
        [orgB, 'viewer'],
      ].sort(),
    );
    expect(forAlice.organizations.map((o) => o.id).sort()).toEqual([orgA, orgB].sort());
    // Not other people's memberships, and never invitations.
    expect(forAlice.memberships.every((m) => m.userId === alice.id)).toBe(true);
    expect(forAlice.invitations).toEqual([]);

    const forBob = await app.withTenant({ userId: bob.id }, (tx) =>
      tx.select().from(organizations),
    );
    expect(forBob.map((o) => o.id)).toEqual([orgB]);
  });

  it('does not carry a context over to the next transaction on the same connection', async () => {
    await app.withTenant({ organizationId: orgA, userId: alice.id }, (tx) =>
      tx.select().from(memberships),
    );
    // Same pooled connection (max 1): the settings now read '' and must not break the casts.
    expect(await app.db.select().from(memberships)).toEqual([]);
    expect(await app.withTenant({}, (tx) => tx.select().from(organizations))).toEqual([]);
  });
});

describe('writing', () => {
  it("refuses to insert rows for another organization than the context's", async () => {
    const error = await app
      .withTenant({ organizationId: orgA }, (tx) =>
        tx.insert(memberships).values({ organizationId: orgB, userId: alice.id, role: 'admin' }),
      )
      .catch((e: unknown) => e);
    expect(pgErrorCode(error)).toBe('42501');
  });

  it("cannot update or delete another organization's rows, even when asked for them by id", async () => {
    const result = await app.withTenant({ organizationId: orgA }, async (tx) => ({
      updated: await tx
        .update(memberships)
        .set({ role: 'viewer' })
        .where(eq(memberships.organizationId, orgB))
        .returning(),
      deleted: await tx.delete(invitations).where(eq(invitations.organizationId, orgB)).returning(),
      renamed: await tx
        .update(organizations)
        .set({ name: 'Hijacked' })
        .where(eq(organizations.id, orgB))
        .returning(),
    }));
    expect(result).toEqual({ updated: [], deleted: [], renamed: [] });

    const [b] = await owner.db.select().from(organizations).where(eq(organizations.id, orgB));
    expect(b?.name).toBe('RLS B');
    const bMembers = await owner.db
      .select()
      .from(memberships)
      .where(eq(memberships.organizationId, orgB));
    expect(bMembers.map((m) => m.role).sort()).toEqual(['owner', 'viewer']);
  });

  it("a user's own memberships are readable through the self policy but not writable", async () => {
    const updated = await app.withTenant({ userId: alice.id }, (tx) =>
      tx
        .update(memberships)
        .set({ role: 'owner' })
        .where(eq(memberships.userId, alice.id))
        .returning(),
    );
    expect(updated).toEqual([]);
  });
});

describe('the system path for invitation links', () => {
  it('finds the organization of a token without any context, and only that', async () => {
    const lookup = async (token: string) => {
      const result = await app.db.execute<{ organization_id: string | null }>(
        sql`select forgeflow_invitation_organization(${hashSecretToken(token)}) as organization_id`,
      );
      return result.rows[0]?.organization_id;
    };
    expect(await lookup(tokenB)).toBe(orgB);
    expect(await lookup(randomBytes(32).toString('base64url'))).toBeNull();
  });

  it('is a SECURITY DEFINER function with a pinned search_path that only the api role may call', async () => {
    const fn = await owner.pool.query<{
      prosecdef: boolean;
      proconfig: string[];
      public_can_execute: boolean;
      app_can_execute: boolean;
    }>(`
      SELECT p.prosecdef, p.proconfig,
             EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS public_can_execute,
             has_function_privilege('forgeflow_app', p.oid, 'EXECUTE') AS app_can_execute
      FROM pg_proc p WHERE p.proname = 'forgeflow_invitation_organization'`);
    expect(fn.rows).toEqual([
      {
        prosecdef: true,
        proconfig: ['search_path=pg_catalog'],
        public_can_execute: false,
        app_can_execute: true,
      },
    ]);
  });
});

describe('projects and environments', () => {
  let projectA: string;
  let projectB: string;

  beforeAll(async () => {
    projectA = randomUUID();
    projectB = randomUUID();
    await owner.db.insert(projects).values([
      { id: projectA, organizationId: orgA, name: 'RLS project' },
      { id: projectB, organizationId: orgB, name: 'RLS project' },
    ]);
    await owner.db.insert(environments).values([
      { organizationId: orgA, projectId: projectA, name: 'production', position: 0 },
      { organizationId: orgB, projectId: projectB, name: 'production', position: 0 },
    ]);
  });

  it("are read only in their organization's context", async () => {
    expect(await app.db.select().from(projects)).toEqual([]);
    expect(await app.db.select().from(environments)).toEqual([]);

    const inA = await app.withTenant({ organizationId: orgA }, async (tx) => ({
      projects: await tx.select().from(projects),
      environments: await tx.select().from(environments),
    }));
    expect(inA.projects.map((p) => p.id)).toEqual([projectA]);
    expect(inA.environments.map((e) => e.projectId)).toEqual([projectA]);

    // A user's own context reaches their memberships, not their organizations' projects.
    expect(await app.withTenant({ userId: alice.id }, (tx) => tx.select().from(projects))).toEqual(
      [],
    );
  });

  it("cannot be written into another organization's project", async () => {
    // Labelled with the other organization: row-level security refuses it.
    const relabelled = await app
      .withTenant({ organizationId: orgA }, (tx) =>
        tx
          .insert(environments)
          .values({ organizationId: orgB, projectId: projectB, name: 'sneaky', position: 9 }),
      )
      .catch((e: unknown) => e);
    expect(pgErrorCode(relabelled)).toBe('42501');

    // Labelled with its own organization but pointing at the other's project: the composite
    // foreign key refuses it.
    const crossLinked = await app
      .withTenant({ organizationId: orgA }, (tx) =>
        tx
          .insert(environments)
          .values({ organizationId: orgA, projectId: projectB, name: 'sneaky', position: 9 }),
      )
      .catch((e: unknown) => e);
    expect(pgErrorCode(crossLinked)).toBe('23503');
  });

  it('cannot point an environment at a project of another organization, even bypassing RLS', async () => {
    // The owner bypasses row-level security; the composite foreign key still holds.
    const error = await owner.db
      .insert(environments)
      .values({ organizationId: orgA, projectId: projectB, name: 'cross', position: 1 })
      .catch((e: unknown) => e);
    expect(pgErrorCode(error)).toBe('23503');

    const moved = await owner.db
      .update(environments)
      .set({ organizationId: orgA })
      .where(eq(environments.projectId, projectB))
      .catch((e: unknown) => e);
    expect(pgErrorCode(moved)).toBe('23503');
  });
});
