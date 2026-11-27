import { Inject, Injectable } from '@nestjs/common';
import { environments, projects, type DatabaseHandle } from '@forgeflow/database';
import { and, eq, max } from 'drizzle-orm';
import { DATABASE } from '../../common/constants/injection-tokens.js';
import type { AuditActor } from '../../common/types/audit.types.js';
import type {
  CreateEnvironmentOutcome,
  EnvironmentChanges,
  UpdateEnvironmentOutcome,
} from '../../common/types/project.types.js';
import { isUniqueViolation } from '../../common/utils/pg-error.util.js';
import { AuditService } from '../audit/audit.service.js';
import { toEnvironment } from './projects.service.js';

/** Environments of a project. Queries run in the organization's tenant context (ADR-0002). */
@Injectable()
export class EnvironmentsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Adds an environment after the project's others. The project row is locked first, so two
   * environments added at the same moment get different positions.
   */
  async create(
    organizationId: string,
    projectId: string,
    input: { name: string; protected: boolean },
    actor: AuditActor,
  ): Promise<CreateEnvironmentOutcome> {
    try {
      return await this.database.withTenant({ organizationId }, async (tx) => {
        const [project] = await tx
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)))
          .for('update');
        if (!project) return { status: 'project_not_found' };

        const [last] = await tx
          .select({ position: max(environments.position) })
          .from(environments)
          .where(eq(environments.projectId, projectId));
        const [environment] = await tx
          .insert(environments)
          .values({
            organizationId,
            projectId,
            name: input.name,
            protected: input.protected,
            position: (last?.position ?? -1) + 1,
          })
          .returning();
        if (!environment) throw new Error('Environment insert returned no row');
        await this.audit.record(tx, {
          organizationId,
          actor,
          action: 'environment.created',
          target: { type: 'environment', id: environment.id },
          metadata: { project: project.name, name: input.name, protected: input.protected },
        });
        return { status: 'created', environment: toEnvironment(environment) };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'environments_project_name_key'))
        return { status: 'name_taken' };
      throw error;
    }
  }

  /**
   * Renames an environment of the project, protects or unprotects it, or both. Each actual
   * change gets its own audit entry (renamed; protected / unprotected).
   */
  async update(
    organizationId: string,
    projectId: string,
    environmentId: string,
    changes: EnvironmentChanges,
    actor: AuditActor,
  ): Promise<UpdateEnvironmentOutcome> {
    try {
      return await this.database.withTenant(
        { organizationId },
        async (tx): Promise<UpdateEnvironmentOutcome> => {
          const where = and(
            eq(environments.organizationId, organizationId),
            eq(environments.projectId, projectId),
            eq(environments.id, environmentId),
          );
          const [before] = await tx
            .select({
              name: environments.name,
              protected: environments.protected,
              project: projects.name,
            })
            .from(environments)
            .innerJoin(projects, eq(projects.id, environments.projectId))
            .where(where)
            .for('update', { of: environments });
          if (!before) return { status: 'not_found' };

          const [environment] = await tx
            .update(environments)
            .set({
              ...(changes.name === undefined ? {} : { name: changes.name }),
              ...(changes.protected === undefined ? {} : { protected: changes.protected }),
            })
            .where(where)
            .returning();
          if (!environment) return { status: 'not_found' };

          const target = { type: 'environment', id: environmentId } as const;
          if (environment.name !== before.name) {
            await this.audit.record(tx, {
              organizationId,
              actor,
              action: 'environment.renamed',
              target,
              metadata: { project: before.project, from: before.name, to: environment.name },
            });
          }
          if (environment.protected !== before.protected) {
            await this.audit.record(tx, {
              organizationId,
              actor,
              action: environment.protected ? 'environment.protected' : 'environment.unprotected',
              target,
              metadata: { project: before.project, name: environment.name },
            });
          }
          return { status: 'updated', environment: toEnvironment(environment) };
        },
      );
    } catch (error) {
      if (isUniqueViolation(error, 'environments_project_name_key'))
        return { status: 'name_taken' };
      throw error;
    }
  }
}
