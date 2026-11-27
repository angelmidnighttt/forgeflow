import { Inject, Injectable, Logger } from '@nestjs/common';
import { can, type GithubSetupError, type OrganizationRole } from '@forgeflow/contracts';
import {
  integrations,
  memberships,
  type DatabaseHandle,
  type DbExecutor,
  type IntegrationRow,
} from '@forgeflow/database';
import type { CookieOptions, Request, Response } from 'express';
import { and, eq, or, sql } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { API_ENV, DATABASE } from '../../common/constants/injection-tokens.js';
import type { AuditActor } from '../../common/types/audit.types.js';
import type {
  GithubInstallation,
  GithubInstallState,
  GithubRepository,
} from '../../common/types/github.types.js';
import type { GithubWebhookEventPayload } from '../../common/types/outbox.types.js';
import type { MembershipContext } from '../../common/types/organization.types.js';
import { isUniqueViolation } from '../../common/utils/pg-error.util.js';
import { generateSecretToken, isSecretToken } from '../../common/utils/secret-token.util.js';
import type { ApiEnv } from '../../config/env.js';
import { AuditService } from '../audit/audit.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { GithubApiError, GithubAppService } from './github-app.service.js';
import { RepositoriesService } from './repositories.service.js';

const STATE_AUDIENCE = 'forgeflow:github-install';
const STATE_TTL_SECONDS = 15 * 60;
/** Ties the setup redirect to the browser that started the installation (CSRF). */
const STATE_COOKIE = {
  name: 'ff_github',
  secureName: '__Secure-ff_github',
  path: '/api/v1/github',
};

/** Where the setup redirect sends the browser back to, in the web app. */
export function integrationsPage(origin: string, organizationId: string | null): URL {
  return new URL(organizationId ? `/orgs/${organizationId}/integrations` : '/', origin);
}

class SetupFailure extends Error {
  constructor(readonly code: GithubSetupError) {
    super(code);
  }
}

/**
 * Connecting GitHub App installations to organizations, and keeping them in step afterwards.
 *
 * Installing goes through GitHub and back to /api/v1/github/setup. That request names an
 * installation, so before linking it to the organization of the signed `state` three things are
 * checked: the state is the one this browser started (cookie), GitHub vouches for the user's
 * access to that installation (the App's own OAuth: GET /user/installations), and the
 * ForgeFlow user still manages the organization's integrations. An installation belongs to one
 * organization at most.
 */
@Injectable()
export class GithubInstallationsService {
  private readonly logger = new Logger(GithubInstallationsService.name);
  private readonly stateKey: Uint8Array;
  private readonly secureCookie: boolean;

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(GithubAppService) private readonly github: GithubAppService,
    @Inject(IntegrationsService) private readonly integrationsService: IntegrationsService,
    @Inject(RepositoriesService) private readonly repositories: RepositoriesService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.stateKey = new TextEncoder().encode(env.JWT_SECRET);
    this.secureCookie = env.COOKIE_SECURE ?? env.NODE_ENV === 'production';
  }

  /** The GitHub URL that installs the App for `membership`'s organization (sets the cookie). */
  async installLink(res: Response, membership: MembershipContext): Promise<string> {
    const nonce = generateSecretToken();
    const state = await new SignJWT({ org: membership.organizationId, nonce })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience(STATE_AUDIENCE)
      .setSubject(membership.userId)
      .setIssuedAt()
      .setExpirationTime(`${STATE_TTL_SECONDS}s`)
      .sign(this.stateKey);
    res.cookie(this.cookieName(), nonce, {
      ...this.cookieOptions(),
      maxAge: STATE_TTL_SECONDS * 1000,
    });
    return this.github.installUrl(state);
  }

  /**
   * GitHub's redirect after installing: links the installation and returns where to send the
   * browser (the organization's integrations page, with ?github=connected or ?github_error=).
   */
  async completeSetup(
    req: Request,
    res: Response,
    query: { installationId?: string; setupAction?: string; code?: string; state?: string },
    client: { ipAddress: string | null; requestId: string | null },
  ): Promise<URL> {
    const cookie: unknown = req.cookies?.[this.cookieName()];
    res.clearCookie(this.cookieName(), this.cookieOptions());
    const state = await this.verifyState(query.state, cookie);
    if (!state) return this.backTo(null, { github_error: 'state' });

    try {
      if (query.setupAction === 'request') {
        // Someone without the right to install asked an owner of the account to do it.
        return this.backTo(state.organizationId, { github: 'requested' });
      }
      if (!query.code) throw new SetupFailure('authorization');
      if (!query.installationId || !/^\d+$/.test(query.installationId)) {
        throw new SetupFailure('not_yours');
      }
      const userToken = await this.github.exchangeUserCode(query.code);
      const installation = (await this.github.userInstallations(userToken)).find(
        (candidate) => String(candidate.id) === query.installationId,
      );
      if (!installation) throw new SetupFailure('not_yours');

      const actor: AuditActor = { userId: state.userId, ...client };
      const integrationId = await this.link(state.organizationId, installation, actor);
      await this.syncRepositories(state.organizationId, integrationId, String(installation.id));
      return this.backTo(state.organizationId, { github: 'connected' });
    } catch (error) {
      if (error instanceof SetupFailure) {
        return this.backTo(state.organizationId, { github_error: error.code });
      }
      if (error instanceof GithubApiError) {
        this.logger.warn({ err: error }, 'GitHub failed during the App setup');
        return this.backTo(state.organizationId, { github_error: 'github' });
      }
      throw error;
    }
  }

  /** The worker's handling of `installation` events. */
  async onInstallationEvent(
    webhook: GithubWebhookEventPayload,
    organizationId: string | null,
  ): Promise<void> {
    if (!organizationId || !webhook.installationId) return; // not linked to any organization
    const installationId = webhook.installationId;
    if (webhook.action === 'deleted' || webhook.action === 'suspend') {
      this.github.forgetInstallation(installationId);
      await this.setStatus(organizationId, installationId, 'disabled', {
        reason: webhook.action === 'deleted' ? 'uninstalled' : 'suspended',
      });
      return;
    }
    if (webhook.action === 'unsuspend' || webhook.action === 'created') {
      const integration = await this.setStatus(organizationId, installationId, 'active', {
        reason: webhook.action === 'created' ? 'installed' : 'unsuspended',
      });
      if (integration) await this.syncRepositories(organizationId, integration.id, installationId);
    }
  }

  /** The worker's handling of `installation_repositories` events (repositories added, removed). */
  async onInstallationRepositoriesEvent(
    webhook: GithubWebhookEventPayload,
    organizationId: string | null,
  ): Promise<void> {
    if (!organizationId || !webhook.integrationId) return;
    const integrationId = webhook.integrationId;
    const added = (webhook.body.repositories_added ?? []) as GithubRepository[];
    const removed = (webhook.body.repositories_removed ?? []) as Array<{ id: number }>;
    await this.database.withTenant({ organizationId }, async (tx) => {
      await this.repositories.upsert(tx, organizationId, integrationId, added);
      await this.repositories.remove(
        tx,
        integrationId,
        removed.map((repo) => String(repo.id)),
      );
    });
  }

  /** Re-reads the installation's repositories from GitHub and stores exactly those. */
  async syncRepositories(
    organizationId: string,
    integrationId: string,
    installationId: string,
  ): Promise<void> {
    const repos = await this.github.installationRepositories(installationId);
    await this.database.withTenant({ organizationId }, (tx) =>
      this.repositories.replaceAll(tx, organizationId, integrationId, repos),
    );
  }

  /**
   * Links the installation to the organization: reuses the organization's integration for the
   * same GitHub account (a reinstall gets a new installation id), or creates one.
   */
  private async link(
    organizationId: string,
    installation: GithubInstallation,
    actor: AuditActor,
  ): Promise<string> {
    const externalId = String(installation.id);
    const account = installation.account?.login ?? `installation-${externalId}`;
    const config = {
      account,
      accountType: installation.account?.type ?? null,
      htmlUrl: installation.html_url ?? installation.account?.html_url ?? null,
    };
    try {
      const existing = await this.database.withTenant({ organizationId }, async (tx) => {
        const role = await roleOf(tx, organizationId, actor.userId);
        if (!role || !can(role, 'integrations.manage')) throw new SetupFailure('forbidden');
        const [row] = await tx
          .select()
          .from(integrations)
          .where(
            and(
              eq(integrations.organizationId, organizationId),
              eq(integrations.kind, 'github'),
              or(
                eq(integrations.externalId, externalId),
                sql`${integrations.config}->>'account' = ${account}`,
              ),
            ),
          )
          .limit(1)
          .for('update');
        if (!row) return undefined;
        await tx
          .update(integrations)
          .set({ externalId, status: 'active', config })
          .where(eq(integrations.id, row.id));
        if (row.status !== 'active' || row.externalId !== externalId) {
          await this.audit.record(tx, {
            organizationId,
            actor,
            action: 'integration.enabled',
            target: { type: 'integration', id: row.id },
            metadata: { integration: row.name, kind: 'github', reason: 'installed' },
          });
        }
        return row.id;
      });
      if (existing) return existing;
      const create = (name: string) =>
        this.integrationsService.create(
          organizationId,
          { kind: 'github', name, externalId, config },
          actor,
        );
      try {
        return (await create(`GitHub ${account}`)).integration.id;
      } catch (error) {
        // Another integration of the organization already has that name.
        if (!isUniqueViolation(error, 'integrations_organization_name_key')) throw error;
        return (await create(`GitHub ${account} (${externalId})`)).integration.id;
      }
    } catch (error) {
      if (isUniqueViolation(error, 'integrations_kind_external_id_key')) {
        throw new SetupFailure('taken');
      }
      throw error;
    }
  }

  private async setStatus(
    organizationId: string,
    installationId: string,
    status: 'active' | 'disabled',
    metadata: { reason: string },
  ): Promise<IntegrationRow | undefined> {
    return this.database.withTenant({ organizationId }, async (tx) => {
      const [row] = await tx
        .select()
        .from(integrations)
        .where(
          and(
            eq(integrations.organizationId, organizationId),
            eq(integrations.kind, 'github'),
            eq(integrations.externalId, installationId),
          ),
        )
        .for('update');
      if (!row) return undefined;
      if (row.status === status) return row;
      const [updated] = await tx
        .update(integrations)
        .set({ status })
        .where(eq(integrations.id, row.id))
        .returning();
      await this.audit.record(tx, {
        organizationId,
        actor: 'system',
        action: status === 'active' ? 'integration.enabled' : 'integration.disabled',
        target: { type: 'integration', id: row.id },
        metadata: { integration: row.name, kind: 'github', ...metadata },
      });
      return updated;
    });
  }

  private async verifyState(
    state: string | undefined,
    cookie: unknown,
  ): Promise<GithubInstallState | undefined> {
    if (!state || typeof cookie !== 'string' || !isSecretToken(cookie)) return undefined;
    try {
      const { payload } = await jwtVerify(state, this.stateKey, {
        algorithms: ['HS256'],
        audience: STATE_AUDIENCE,
      });
      if (
        typeof payload.org !== 'string' ||
        typeof payload.sub !== 'string' ||
        payload.nonce !== cookie
      ) {
        return undefined;
      }
      return { organizationId: payload.org, userId: payload.sub, nonce: cookie };
    } catch {
      return undefined;
    }
  }

  private backTo(organizationId: string | null, params: Record<string, string>): URL {
    const url = integrationsPage(this.env.APP_ORIGIN, organizationId);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  }

  private cookieName(): string {
    return this.secureCookie ? STATE_COOKIE.secureName : STATE_COOKIE.name;
  }

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.secureCookie, sameSite: 'lax', path: STATE_COOKIE.path };
  }
}

async function roleOf(
  tx: DbExecutor,
  organizationId: string,
  userId: string,
): Promise<OrganizationRole | undefined> {
  const [row] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)));
  return row?.role;
}
