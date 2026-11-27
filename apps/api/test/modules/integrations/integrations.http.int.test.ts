import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  auditLogPageSchema,
  integrationSchema,
  rotatedIntegrationSecretSchema,
} from '@forgeflow/contracts';
import { createDatabase, integrationSecrets, type DatabaseHandle } from '@forgeflow/database';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from '../../../src/app.factory.js';
import type { AuditActor } from '../../../src/common/types/audit.types.js';
import type { NewIntegration } from '../../../src/common/types/integration.types.js';
import { open, seal, secretContext } from '../../../src/common/utils/envelope.util.js';
import { rewrapSecrets } from '../../../src/common/utils/secret-rewrap.util.js';
import { IntegrationSecretsService } from '../../../src/modules/integrations/integration-secrets.service.js';
import { IntegrationsService } from '../../../src/modules/integrations/integrations.service.js';
import {
  bearer,
  client,
  envFor,
  keyring,
  registerUser,
  type SignedIn,
} from '../../support/http.js';
import { addMember, createOrganization, verifiedUser } from '../../support/organizations.js';
import { testDatabaseUrl, testOwnerDatabaseUrl } from '../../support/test-database.js';

// Key 2 is current: this file also checks rewrapping secrets from key 1. Rewrapping covers the
// whole shared test database, so every test file seals real values with key 1 (TEST_KEYRING),
// which this keyring holds too: their secrets move to key 2 and still open.
const KEY_1 = `1:${Buffer.alloc(32, 0x11).toString('base64')}`;
const KEY_2 = `2:${Buffer.alloc(32, 0x22).toString('base64')}`;
const KEYS = keyring(`${KEY_2},${KEY_1}`);

let database: DatabaseHandle;
let app: INestApplication;
let integrationsService: IntegrationsService;
let secretsService: IntegrationSecretsService;

beforeAll(async () => {
  database = createDatabase(testOwnerDatabaseUrl(), { max: 2 });
  app = await createApp(envFor({ SECRET_ENCRYPTION_KEYS: KEYS }));
  await app.init();
  integrationsService = app.get(IntegrationsService);
  secretsService = app.get(IntegrationSecretsService);
});

afterAll(async () => {
  await app.close();
  await database.close();
});

const actorOf = (user: SignedIn): AuditActor => ({
  userId: user.body.user.id,
  ipAddress: null,
  requestId: null,
});
const PROVIDED = 'hunter2-provided-credential';

/** An organization with an owner, a member, a viewer, and one integration with two secrets. */
async function setup(input: Partial<NewIntegration> = {}) {
  const owner = await verifiedUser(app, database);
  const organization = await createOrganization(app, owner);
  const member = await registerUser(app);
  const viewer = await registerUser(app);
  await addMember(database, organization.id, member, 'member');
  await addMember(database, organization.id, viewer, 'viewer');
  const created = await integrationsService.create(
    organization.id,
    {
      kind: 'webhook',
      name: `Webhook ${randomUUID().slice(0, 8)}`,
      config: { url: 'https://hooks.example.test/forgeflow' },
      secrets: [
        { name: 'signing_secret', source: 'generated' },
        { name: 'password', source: 'provided', value: PROVIDED },
      ],
      ...input,
    },
    actorOf(owner),
  );
  const url = `/api/v1/organizations/${organization.id}/integrations/${created.integration.id}`;
  return { owner, member, viewer, organization, created, url };
}

async function storedRows(integrationId: string) {
  return database.db
    .select()
    .from(integrationSecrets)
    .where(eq(integrationSecrets.integrationId, integrationId));
}

describe('reading integrations', () => {
  it("never returns a secret's value, nor its ciphertext", async () => {
    const { owner, organization, created, url } = await setup();
    const generated = created.generated.signing_secret!;
    expect(generated).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const list = await client(app)
      .get(`/api/v1/organizations/${organization.id}/integrations`)
      .set('Authorization', bearer(owner))
      .expect(200);
    const one = await client(app).get(url).set('Authorization', bearer(owner)).expect(200);

    const integration = integrationSchema.parse(one.body.data);
    expect(z.array(integrationSchema).parse(list.body.data)).toEqual([integration]);
    expect(integration).toMatchObject({
      kind: 'webhook',
      status: 'active',
      projectId: null,
      config: { url: 'https://hooks.example.test/forgeflow' },
    });
    expect(integration.secrets.map((s) => [s.name, s.version, s.source, s.status])).toEqual([
      ['password', 1, 'provided', 'active'],
      ['signing_secret', 1, 'generated', 'active'],
    ]);

    const rows = await storedRows(created.integration.id);
    for (const body of [list.text, one.text]) {
      expect(body).not.toContain(generated);
      expect(body).not.toContain(PROVIDED);
      for (const row of rows) {
        expect(body).not.toContain(row.ciphertext.toString('base64'));
        expect(body).not.toContain(row.ciphertext.toString('hex'));
      }
    }
  });

  it('stores values encrypted, under the current key, bound to their place', async () => {
    const { organization, created } = await setup();
    const rows = await storedRows(created.integration.id);
    for (const row of rows) {
      expect(row.kekVersion).toBe(2);
      expect(row.ciphertext.includes(Buffer.from(PROVIDED))).toBe(false);
      expect(row.wrappedKey.length).toBe(60);
    }
    expect(await secretsService.reveal(organization.id, created.integration.id, 'password')).toBe(
      PROVIDED,
    );
    expect(
      await secretsService.reveal(organization.id, created.integration.id, 'signing_secret'),
    ).toBe(created.generated.signing_secret);
    expect(
      await secretsService.reveal(organization.id, created.integration.id, 'missing'),
    ).toBeUndefined();
  });

  it("does not open a ciphertext copied into another organization's secret", async () => {
    const a = await setup();
    const b = await setup();
    const [fromA] = (await storedRows(a.created.integration.id)).filter(
      (r) => r.name === 'password',
    );
    await database.db
      .update(integrationSecrets)
      .set({ wrappedKey: fromA!.wrappedKey, ciphertext: fromA!.ciphertext })
      .where(
        and(
          eq(integrationSecrets.integrationId, b.created.integration.id),
          eq(integrationSecrets.name, 'password'),
        ),
      );
    await expect(
      secretsService.reveal(b.organization.id, b.created.integration.id, 'password'),
    ).rejects.toThrow();
  });
});

describe('POST …/integrations/:integrationId/secrets/:name/rotate', () => {
  it('gives a generated secret a new value, shown in this answer only', async () => {
    const { owner, organization, created, url } = await setup();
    const res = await client(app)
      .post(`${url}/secrets/signing_secret/rotate`)
      .set('Authorization', bearer(owner))
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const rotated = rotatedIntegrationSecretSchema.parse(res.body.data);
    expect(rotated.secret).toMatchObject({ name: 'signing_secret', version: 2, status: 'active' });
    expect(rotated.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rotated.value).not.toBe(created.generated.signing_secret);

    const id = created.integration.id;
    expect(await secretsService.reveal(organization.id, id, 'signing_secret')).toBe(rotated.value);
    const versions = (await storedRows(id)).filter((r) => r.name === 'signing_secret');
    expect(versions.map((r) => [r.version, r.revokedAt === null]).sort()).toEqual([
      [1, false],
      [2, true],
    ]);
    const after = await client(app).get(url).set('Authorization', bearer(owner)).expect(200);
    expect(after.text).not.toContain(rotated.value!);
  });

  it('takes the new value of a provided secret, and refuses a value for a generated one', async () => {
    const { owner, organization, created, url } = await setup();
    const as = { Authorization: bearer(owner) };

    const missing = await client(app).post(`${url}/secrets/password/rotate`).set(as).expect(400);
    expect(missing.body.error.code).toBe('BAD_REQUEST');
    const rotated = await client(app)
      .post(`${url}/secrets/password/rotate`)
      .set(as)
      .send({ value: 'new-credential' })
      .expect(200);
    expect(rotatedIntegrationSecretSchema.parse(rotated.body.data)).toMatchObject({
      secret: { name: 'password', version: 2, source: 'provided' },
      value: null,
    });
    expect(await secretsService.reveal(organization.id, created.integration.id, 'password')).toBe(
      'new-credential',
    );

    await client(app)
      .post(`${url}/secrets/signing_secret/rotate`)
      .set(as)
      .send({ value: 'chosen' })
      .expect(400);
  });

  it('gives concurrent rotations distinct versions, with one in use', async () => {
    const { owner, organization, created, url } = await setup();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        client(app)
          .post(`${url}/secrets/signing_secret/rotate`)
          .set('Authorization', bearer(owner)),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const rows = (await storedRows(created.integration.id)).filter(
      (r) => r.name === 'signing_secret',
    );
    expect(rows.map((r) => r.version).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    const usable = rows.filter((r) => r.revokedAt === null);
    expect(usable.map((r) => r.version)).toEqual([6]);
    const last = results
      .map((r) => rotatedIntegrationSecretSchema.parse(r.body.data))
      .find((r) => r.secret.version === 6);
    expect(
      await secretsService.reveal(organization.id, created.integration.id, 'signing_secret'),
    ).toBe(last!.value);
  });
});

describe('DELETE …/integrations/:integrationId/secrets/:name', () => {
  it('revokes the secret until it is rotated again', async () => {
    const { owner, organization, created, url } = await setup();
    const as = { Authorization: bearer(owner) };
    const id = created.integration.id;

    await client(app).delete(`${url}/secrets/password`).set(as).expect(204);
    expect(await secretsService.reveal(organization.id, id, 'password')).toBeUndefined();
    const after = integrationSchema.parse(
      (await client(app).get(url).set(as).expect(200)).body.data,
    );
    expect(after.secrets.find((s) => s.name === 'password')).toMatchObject({
      version: 1,
      status: 'revoked',
    });
    // Revoking again changes nothing.
    await client(app).delete(`${url}/secrets/password`).set(as).expect(204);

    await client(app)
      .post(`${url}/secrets/password/rotate`)
      .set(as)
      .send({ value: 'back' })
      .expect(200);
    expect(await secretsService.reveal(organization.id, id, 'password')).toBe('back');
  });
});

describe('access', () => {
  it('lets every member read, and only owners and admins rotate or revoke', async () => {
    const { member, viewer, url } = await setup();
    for (const user of [member, viewer]) {
      await client(app).get(url).set('Authorization', bearer(user)).expect(200);
      const rotate = await client(app)
        .post(`${url}/secrets/signing_secret/rotate`)
        .set('Authorization', bearer(user))
        .expect(403);
      expect(rotate.body.error.code).toBe('ROLE_NOT_ALLOWED');
      await client(app)
        .delete(`${url}/secrets/password`)
        .set('Authorization', bearer(user))
        .expect(403);
    }
  });

  it('answers 404 for unknown integrations and secrets, and 400 for malformed ones', async () => {
    const { owner, organization, url } = await setup();
    const as = { Authorization: bearer(owner) };
    const base = `/api/v1/organizations/${organization.id}/integrations`;
    const unknown = await client(app).get(`${base}/${randomUUID()}`).set(as).expect(404);
    expect(unknown.body.error.message).toBe('Integration not found.');
    await client(app).post(`${base}/${randomUUID()}/secrets/password/rotate`).set(as).expect(404);
    await client(app).post(`${url}/secrets/nothing_here/rotate`).set(as).expect(404);
    await client(app).delete(`${url}/secrets/nothing_here`).set(as).expect(404);
    await client(app).get(`${base}/not-a-uuid`).set(as).expect(400);
    await client(app).post(`${url}/secrets/Bad-Name/rotate`).set(as).expect(400);
  });

  it("never shows or changes another organization's integrations (required test #5)", async () => {
    const a = await setup();
    const b = await setup();
    const as = { Authorization: bearer(a.owner) };
    // Org B's URLs: org A's owner is not a member.
    for (const res of await Promise.all([
      client(app).get(`/api/v1/organizations/${b.organization.id}/integrations`).set(as),
      client(app).get(b.url).set(as),
      client(app).post(`${b.url}/secrets/signing_secret/rotate`).set(as),
      client(app).delete(`${b.url}/secrets/password`).set(as),
    ])) {
      expect(res.status).toBe(404);
    }
    // Org B's integration through org A's URL.
    const mixed = `/api/v1/organizations/${a.organization.id}/integrations/${b.created.integration.id}`;
    await client(app).get(mixed).set(as).expect(404);
    await client(app).post(`${mixed}/secrets/signing_secret/rotate`).set(as).expect(404);
    await client(app).delete(`${mixed}/secrets/password`).set(as).expect(404);

    const untouched = await client(app)
      .get(b.url)
      .set('Authorization', bearer(b.owner))
      .expect(200);
    expect(integrationSchema.parse(untouched.body.data).secrets.every((s) => s.version === 1)).toBe(
      true,
    );
  });
});

describe('the audit trail', () => {
  it('records creating, rotating and revoking, never with a value', async () => {
    const { owner, organization, created, url } = await setup();
    const as = { Authorization: bearer(owner) };
    const rotated = await client(app)
      .post(`${url}/secrets/signing_secret/rotate`)
      .set(as)
      .expect(200);
    await client(app).delete(`${url}/secrets/password`).set(as).expect(204);

    const res = await client(app)
      .get(`/api/v1/organizations/${organization.id}/audit-logs`)
      .set(as)
      .expect(200);
    const entries = auditLogPageSchema.parse(res.body.data).entries.reverse();
    expect(entries.map((e) => e.action)).toEqual([
      'organization.created',
      'integration.created',
      'integration.secret_rotated',
      'integration.secret_revoked',
    ]);
    expect(entries[1]!.metadata).toMatchObject({
      kind: 'webhook',
      secrets: ['signing_secret', 'password'],
    });
    expect(entries[2]!.metadata).toEqual({
      integration: created.integration.name,
      kind: 'webhook',
      secret: 'signing_secret',
      version: 2,
    });
    expect(entries[3]!.metadata).toMatchObject({ secret: 'password', version: 1 });
    expect(res.text).not.toContain(rotated.body.data.value as string);
    expect(res.text).not.toContain(PROVIDED);
  });
});

describe('rotating the key-encryption key', () => {
  it('rewraps secrets under the current key, after which the old key can go', async () => {
    const { organization, created } = await setup({ secrets: [] });
    const id = created.integration.id;
    // A secret sealed while key 1 was current.
    const oldKeys = keyring(KEY_1);
    const context = secretContext({
      organizationId: organization.id,
      integrationId: id,
      name: 'legacy',
      version: 1,
    });
    const sealed = seal(oldKeys, 'from the key 1 days', context);
    await database.db.insert(integrationSecrets).values({
      organizationId: organization.id,
      integrationId: id,
      name: 'legacy',
      version: 1,
      source: 'provided',
      kekVersion: sealed.kekVersion,
      wrappedKey: sealed.wrappedKey,
      ciphertext: sealed.ciphertext,
    });
    expect(await secretsService.reveal(organization.id, id, 'legacy')).toBe('from the key 1 days');

    expect(await rewrapSecrets(database, KEYS)).toBeGreaterThanOrEqual(1);
    const [row] = await storedRows(id);
    expect(row!.kekVersion).toBe(2);
    expect(row!.ciphertext.equals(sealed.ciphertext)).toBe(true);
    // Key 1 is no longer needed.
    expect(open(keyring(KEY_2), row!, context)).toBe('from the key 1 days');
    // Running it again leaves this secret as it is.
    await rewrapSecrets(database, KEYS);
    const [again] = await storedRows(id);
    expect(again!.wrappedKey.equals(row!.wrappedKey)).toBe(true);
  });

  it("refuses to run as the api's role, which would see no secret", async () => {
    const appRole = createDatabase(testDatabaseUrl(), { max: 1 });
    try {
      await expect(rewrapSecrets(appRole, KEYS)).rejects.toThrow(/owner of the tables/);
    } finally {
      await appRole.close();
    }
  });
});
