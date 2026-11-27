import { Inject, Injectable } from '@nestjs/common';
import type { ApiToken, CreateApiTokenRequest, CreatedApiToken } from '@forgeflow/contracts';
import {
  apiTokens,
  projects,
  users,
  type ApiTokenRow,
  type DatabaseHandle,
} from '@forgeflow/database';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { CLOCK, DATABASE } from '../../common/constants/injection-tokens.js';
import type { ApiTokenContext } from '../../common/types/api-token.types.js';
import type { AuditActor } from '../../common/types/audit.types.js';
import type { Clock } from '../../common/types/clock.types.js';
import {
  generateSecretToken,
  hashSecretToken,
  isSecretToken,
} from '../../common/utils/secret-token.util.js';
import { AuditService } from '../audit/audit.service.js';

/** Every API token starts with this, so a leaked one is easy to recognize and search for. */
export const API_TOKEN_PREFIX = 'ffp_';
const DAY_MS = 24 * 60 * 60 * 1000;
/** last_used_at is written at most this often per token. */
const LAST_USED_RESOLUTION_MS = 60 * 1000;

interface TokenContextRow extends Record<string, unknown> {
  token_id: string;
  organization_id: string;
  project_id: string;
  scopes: string[];
  expires_at: Date | null;
  revoked_at: Date | null;
}

/**
 * API tokens of projects, for pipelines that report deployments. Only the SHA-256 hash is stored;
 * the token itself is in the answer that creates it and nowhere else. Revoked, never deleted.
 */
@Injectable()
export class ApiTokensService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(CLOCK) private readonly now: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(
    actor: AuditActor,
    organizationId: string,
    projectId: string,
    input: CreateApiTokenRequest,
  ): Promise<CreatedApiToken | undefined> {
    const secret = `${API_TOKEN_PREFIX}${generateSecretToken()}`;
    return this.database.withTenant({ organizationId }, async (tx) => {
      const [project] = await tx
        .select({ name: projects.name })
        .from(projects)
        .where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)));
      if (!project) return undefined;
      const [row] = await tx
        .insert(apiTokens)
        .values({
          organizationId,
          projectId,
          name: input.name,
          tokenHash: hashSecretToken(secret),
          prefix: secret.slice(0, API_TOKEN_PREFIX.length + 4),
          scopes: ['deployments:write'],
          createdBy: actor.userId,
          expiresAt: input.expiresInDays
            ? new Date(this.now().getTime() + input.expiresInDays * DAY_MS)
            : null,
        })
        .returning();
      if (!row) throw new Error('API token insert returned no row');
      await this.audit.record(tx, {
        organizationId,
        actor,
        action: 'api_token.created',
        target: { type: 'api_token', id: row.id },
        metadata: { project: project.name, name: row.name, prefix: row.prefix },
      });
      const [creator] = await tx
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, actor.userId));
      return { token: toApiToken(row, creator ?? null), secret };
    });
  }

  /** The project's tokens, newest first, revoked ones included. */
  async list(organizationId: string, projectId: string): Promise<ApiToken[]> {
    const rows = await this.database.withTenant({ organizationId }, (tx) =>
      tx
        .select({ token: apiTokens, creatorName: users.name, creatorEmail: users.email })
        .from(apiTokens)
        .leftJoin(users, eq(users.id, apiTokens.createdBy))
        .where(
          and(eq(apiTokens.organizationId, organizationId), eq(apiTokens.projectId, projectId)),
        )
        .orderBy(desc(apiTokens.createdAt)),
    );
    return rows.map((row) =>
      toApiToken(
        row.token,
        row.creatorEmail ? { name: row.creatorName, email: row.creatorEmail } : null,
      ),
    );
  }

  /** Revokes a token of the project; false when there is no such token still in use. */
  async revoke(
    actor: AuditActor,
    organizationId: string,
    projectId: string,
    tokenId: string,
  ): Promise<boolean> {
    return this.database.withTenant({ organizationId }, async (tx) => {
      const [row] = await tx
        .update(apiTokens)
        .set({ revokedAt: this.now() })
        .where(
          and(
            eq(apiTokens.organizationId, organizationId),
            eq(apiTokens.projectId, projectId),
            eq(apiTokens.id, tokenId),
            isNull(apiTokens.revokedAt),
          ),
        )
        .returning();
      if (!row) return false;
      await this.audit.record(tx, {
        organizationId,
        actor,
        action: 'api_token.revoked',
        target: { type: 'api_token', id: row.id },
        metadata: { name: row.name, prefix: row.prefix },
      });
      return true;
    });
  }

  /**
   * The project a token acts for, when it is a valid token with the deployments:write scope; the
   * lookup goes through forgeflow_api_token_context() since the request has no tenant yet.
   */
  async authenticate(secret: string): Promise<ApiTokenContext | undefined> {
    if (!secret.startsWith(API_TOKEN_PREFIX)) return undefined;
    if (!isSecretToken(secret.slice(API_TOKEN_PREFIX.length))) return undefined;
    const result = await this.database.db.execute<TokenContextRow>(
      sql`select * from forgeflow_api_token_context(${hashSecretToken(secret)})`,
    );
    const row = result.rows[0];
    const now = this.now();
    if (
      !row ||
      row.revoked_at !== null ||
      (row.expires_at !== null && new Date(row.expires_at) <= now) ||
      !row.scopes.includes('deployments:write')
    ) {
      return undefined;
    }
    const context = {
      tokenId: row.token_id,
      organizationId: row.organization_id,
      projectId: row.project_id,
    };
    await this.database.withTenant({ organizationId: context.organizationId }, (tx) =>
      tx
        .update(apiTokens)
        .set({ lastUsedAt: now })
        .where(
          and(
            eq(apiTokens.id, context.tokenId),
            sql`(${apiTokens.lastUsedAt} IS NULL OR ${apiTokens.lastUsedAt} < ${new Date(
              now.getTime() - LAST_USED_RESOLUTION_MS,
            ).toISOString()}::timestamptz)`,
          ),
        ),
    );
    return context;
  }
}

function toApiToken(
  row: ApiTokenRow,
  createdBy: { name: string | null; email: string } | null,
): ApiToken {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
