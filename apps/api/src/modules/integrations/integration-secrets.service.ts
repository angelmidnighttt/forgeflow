import { Inject, Injectable } from '@nestjs/common';
import type { IntegrationSecret } from '@forgeflow/contracts';
import {
  integrations,
  integrationSecrets,
  type DatabaseHandle,
  type DbExecutor,
  type IntegrationRow,
  type IntegrationSecretRow,
  type SecretSource,
} from '@forgeflow/database';
import { and, asc, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { API_ENV, DATABASE } from '../../common/constants/injection-tokens.js';
import type { AuditActor } from '../../common/types/audit.types.js';
import type {
  RevokeSecretOutcome,
  RotateSecretOutcome,
} from '../../common/types/integration.types.js';
import { open, seal, secretContext } from '../../common/utils/envelope.util.js';
import { generateSecretToken } from '../../common/utils/secret-token.util.js';
import type { ApiEnv } from '../../config/env.js';
import { AuditService } from '../audit/audit.service.js';

/** The columns that describe a secret, without its ciphertext. */
const secretMetadata = {
  integrationId: integrationSecrets.integrationId,
  name: integrationSecrets.name,
  version: integrationSecrets.version,
  source: integrationSecrets.source,
  createdAt: integrationSecrets.createdAt,
  revokedAt: integrationSecrets.revokedAt,
};
type SecretMetadataRow = Pick<
  IntegrationSecretRow,
  'integrationId' | 'name' | 'version' | 'source' | 'createdAt' | 'revokedAt'
>;

/**
 * Integration secrets under envelope encryption (SECRET_ENCRYPTION_KEYS). A value goes in, and
 * comes out only through reveal(), for the code that talks to the other system; the API shows
 * metadata alone. Changing a secret always adds a version: rotate() revokes the previous one,
 * revoke() the current one. Queries run in the organization's tenant context (ADR-0002).
 */
@Injectable()
export class IntegrationSecretsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Stores `value` as the next version of secret `name` within `tx`, revoking the version in use.
   * The caller holds the integration row locked, so two writers never pick the same version.
   */
  async put(
    tx: DbExecutor,
    secret: {
      organizationId: string;
      integrationId: string;
      name: string;
      value: string;
      source: SecretSource;
      createdBy: string | null;
    },
  ): Promise<IntegrationSecret> {
    const { organizationId, integrationId, name } = secret;
    const [latest] = await tx
      .select({ version: max(integrationSecrets.version) })
      .from(integrationSecrets)
      .where(
        and(eq(integrationSecrets.integrationId, integrationId), eq(integrationSecrets.name, name)),
      );
    const version = (latest?.version ?? 0) + 1;

    await tx
      .update(integrationSecrets)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(integrationSecrets.integrationId, integrationId),
          eq(integrationSecrets.name, name),
          isNull(integrationSecrets.revokedAt),
        ),
      );
    const sealed = seal(
      this.env.SECRET_ENCRYPTION_KEYS,
      secret.value,
      secretContext({ organizationId, integrationId, name, version }),
    );
    const [row] = await tx
      .insert(integrationSecrets)
      .values({
        organizationId,
        integrationId,
        name,
        version,
        source: secret.source,
        kekVersion: sealed.kekVersion,
        wrappedKey: sealed.wrappedKey,
        ciphertext: sealed.ciphertext,
        createdBy: secret.createdBy,
      })
      .returning(secretMetadata);
    if (!row) throw new Error('Secret insert returned no row');
    return toSecret(row);
  }

  /**
   * The value of secret `name` in use, for the code that talks to the other system; undefined
   * when there is none (never set, or revoked). Never send it to a browser.
   */
  async reveal(
    organizationId: string,
    integrationId: string,
    name: string,
  ): Promise<string | undefined> {
    const [row] = await this.database.withTenant({ organizationId }, (tx) =>
      tx
        .select()
        .from(integrationSecrets)
        .where(
          and(
            eq(integrationSecrets.organizationId, organizationId),
            eq(integrationSecrets.integrationId, integrationId),
            eq(integrationSecrets.name, name),
            isNull(integrationSecrets.revokedAt),
          ),
        )
        .limit(1),
    );
    return row ? open(this.env.SECRET_ENCRYPTION_KEYS, row, secretContext(row)) : undefined;
  }

  /**
   * Replaces secret `name` with a new version: one ForgeFlow makes up (returned this once) for a
   * generated secret, `value` for a provided one. Works on a revoked secret too, bringing it back.
   */
  async rotate(
    actor: AuditActor,
    organizationId: string,
    integrationId: string,
    name: string,
    value: string | undefined,
  ): Promise<RotateSecretOutcome> {
    return this.database.withTenant(
      { organizationId },
      async (tx): Promise<RotateSecretOutcome> => {
        const integration = await lockIntegration(tx, organizationId, integrationId);
        if (!integration) return { status: 'integration_not_found' };
        const current = await latestVersion(tx, integrationId, name);
        if (!current) return { status: 'secret_not_found' };
        if (current.source === 'provided' && value === undefined) {
          return { status: 'value_required' };
        }
        if (current.source === 'generated' && value !== undefined) {
          return { status: 'value_not_allowed' };
        }

        const newValue = value ?? generateSecretToken();
        const secret = await this.put(tx, {
          organizationId,
          integrationId,
          name,
          value: newValue,
          source: current.source,
          createdBy: actor.userId,
        });
        await this.audit.record(tx, {
          organizationId,
          actor,
          action: 'integration.secret_rotated',
          target: { type: 'integration', id: integrationId },
          metadata: { ...describe(integration), secret: name, version: secret.version },
        });
        return {
          status: 'rotated',
          secret,
          value: current.source === 'generated' ? newValue : null,
        };
      },
    );
  }

  /** Revokes the version of secret `name` in use: reveal() finds nothing until it is rotated. */
  async revoke(
    actor: AuditActor,
    organizationId: string,
    integrationId: string,
    name: string,
  ): Promise<RevokeSecretOutcome> {
    return this.database.withTenant(
      { organizationId },
      async (tx): Promise<RevokeSecretOutcome> => {
        const integration = await lockIntegration(tx, organizationId, integrationId);
        if (!integration) return { status: 'integration_not_found' };
        const current = await latestVersion(tx, integrationId, name);
        if (!current) return { status: 'secret_not_found' };
        if (current.revokedAt) return { status: 'already_revoked' };

        const [revoked] = await tx
          .update(integrationSecrets)
          .set({ revokedAt: sql`now()` })
          .where(
            and(
              eq(integrationSecrets.integrationId, integrationId),
              eq(integrationSecrets.name, name),
              isNull(integrationSecrets.revokedAt),
            ),
          )
          .returning(secretMetadata);
        if (!revoked) return { status: 'already_revoked' };
        await this.audit.record(tx, {
          organizationId,
          actor,
          action: 'integration.secret_revoked',
          target: { type: 'integration', id: integrationId },
          metadata: { ...describe(integration), secret: name, version: revoked.version },
        });
        return { status: 'revoked', secret: toSecret(revoked) };
      },
    );
  }

  /** The secrets of `integrationIds` (latest version of each name), grouped by integration. */
  async metadataOf(
    db: DbExecutor,
    integrationIds: string[],
  ): Promise<Map<string, IntegrationSecret[]>> {
    const byIntegration = new Map<string, IntegrationSecret[]>();
    if (integrationIds.length === 0) return byIntegration;
    const rows = await db
      .selectDistinctOn([integrationSecrets.integrationId, integrationSecrets.name], secretMetadata)
      .from(integrationSecrets)
      .where(inArray(integrationSecrets.integrationId, integrationIds))
      .orderBy(
        asc(integrationSecrets.integrationId),
        asc(integrationSecrets.name),
        desc(integrationSecrets.version),
      );
    for (const row of rows) {
      const list = byIntegration.get(row.integrationId) ?? [];
      list.push(toSecret(row));
      byIntegration.set(row.integrationId, list);
    }
    return byIntegration;
  }
}

/** The integration, locked for the rest of the transaction (secret versions are serialized). */
async function lockIntegration(
  tx: DbExecutor,
  organizationId: string,
  integrationId: string,
): Promise<IntegrationRow | undefined> {
  const [row] = await tx
    .select()
    .from(integrations)
    .where(and(eq(integrations.organizationId, organizationId), eq(integrations.id, integrationId)))
    .for('update');
  return row;
}

async function latestVersion(
  tx: DbExecutor,
  integrationId: string,
  name: string,
): Promise<SecretMetadataRow | undefined> {
  const [row] = await tx
    .select(secretMetadata)
    .from(integrationSecrets)
    .where(
      and(eq(integrationSecrets.integrationId, integrationId), eq(integrationSecrets.name, name)),
    )
    .orderBy(desc(integrationSecrets.version))
    .limit(1);
  return row;
}

/** What audit entries say about the integration. */
function describe(integration: IntegrationRow) {
  return { integration: integration.name, kind: integration.kind };
}

function toSecret(row: SecretMetadataRow): IntegrationSecret {
  return {
    name: row.name,
    version: row.version,
    source: row.source,
    status: row.revokedAt ? 'revoked' : 'active',
    updatedAt: (row.revokedAt ?? row.createdAt).toISOString(),
  };
}
