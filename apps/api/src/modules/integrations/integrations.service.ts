import { Inject, Injectable } from '@nestjs/common';
import type { Integration, IntegrationSecret } from '@forgeflow/contracts';
import { integrations, type DatabaseHandle, type IntegrationRow } from '@forgeflow/database';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DATABASE } from '../../common/constants/injection-tokens.js';
import type { AuditActor } from '../../common/types/audit.types.js';
import type { CreatedIntegration, NewIntegration } from '../../common/types/integration.types.js';
import { generateSecretToken } from '../../common/utils/secret-token.util.js';
import { AuditService } from '../audit/audit.service.js';
import { IntegrationSecretsService } from './integration-secrets.service.js';

/**
 * An organization's integrations. Reading never returns a secret's value, only its metadata.
 * Queries run in the organization's tenant context (row-level security, ADR-0002).
 */
@Injectable()
export class IntegrationsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(IntegrationSecretsService) private readonly secrets: IntegrationSecretsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Creates an integration with its secrets, in one transaction. Called by the flow that
   * connects it (a GitHub installation, an Alertmanager…); `generated` holds the values
   * ForgeFlow made up, for the caller to show once.
   */
  async create(
    organizationId: string,
    input: NewIntegration,
    actor: AuditActor | 'system',
  ): Promise<CreatedIntegration> {
    return this.database.withTenant({ organizationId }, async (tx) => {
      const [row] = await tx
        .insert(integrations)
        .values({
          organizationId,
          projectId: input.projectId ?? null,
          kind: input.kind,
          name: input.name,
          config: input.config ?? {},
          externalId: input.externalId ?? null,
          createdBy: actor === 'system' ? null : actor.userId,
        })
        .returning();
      if (!row) throw new Error('Integration insert returned no row');

      const generated: Record<string, string> = {};
      const stored: IntegrationSecret[] = [];
      for (const secret of input.secrets ?? []) {
        const value = secret.source === 'provided' ? secret.value : generateSecretToken();
        if (secret.source === 'generated') generated[secret.name] = value;
        stored.push(
          await this.secrets.put(tx, {
            organizationId,
            integrationId: row.id,
            name: secret.name,
            value,
            source: secret.source,
            createdBy: actor === 'system' ? null : actor.userId,
          }),
        );
      }
      await this.audit.record(tx, {
        organizationId,
        actor,
        action: 'integration.created',
        target: { type: 'integration', id: row.id },
        metadata: {
          integration: row.name,
          kind: row.kind,
          projectId: row.projectId,
          secrets: stored.map((secret) => secret.name),
        },
      });
      return { integration: toIntegration(row, stored), generated };
    });
  }

  /** The organization's integrations by kind and name, with their secrets' metadata. */
  async list(organizationId: string): Promise<Integration[]> {
    return this.database.withTenant({ organizationId }, async (tx) => {
      const rows = await tx
        .select()
        .from(integrations)
        .where(eq(integrations.organizationId, organizationId))
        .orderBy(asc(integrations.kind), asc(sql`lower(${integrations.name})`));
      const secrets = await this.secrets.metadataOf(
        tx,
        rows.map((row) => row.id),
      );
      return rows.map((row) => toIntegration(row, secrets.get(row.id) ?? []));
    });
  }

  async get(organizationId: string, integrationId: string): Promise<Integration | undefined> {
    return this.database.withTenant({ organizationId }, async (tx) => {
      const [row] = await tx
        .select()
        .from(integrations)
        .where(
          and(eq(integrations.organizationId, organizationId), eq(integrations.id, integrationId)),
        )
        .limit(1);
      if (!row) return undefined;
      const secrets = await this.secrets.metadataOf(tx, [row.id]);
      return toIntegration(row, secrets.get(row.id) ?? []);
    });
  }
}

function toIntegration(row: IntegrationRow, secrets: IntegrationSecret[]): Integration {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    status: row.status,
    projectId: row.projectId,
    config: row.config,
    externalId: row.externalId,
    secrets: [...secrets].sort((a, b) => a.name.localeCompare(b.name)),
    createdAt: row.createdAt.toISOString(),
  };
}
