import { Inject, Injectable } from '@nestjs/common';
import { environments, projects, type DatabaseHandle } from '@forgeflow/database';
import { and, eq, max } from 'drizzle-orm';
import { DATABASE } from '../../common/constants/injection-tokens.js';
import type {
  CreateEnvironmentOutcome,
  EnvironmentChanges,
  UpdateEnvironmentOutcome,
} from '../../common/types/project.types.js';
import { isUniqueViolation } from '../../common/utils/pg-error.util.js';
import { toEnvironment } from './projects.service.js';

/** Environments of a project. Queries run in the organization's tenant context (ADR-0002). */
@Injectable()
export class EnvironmentsService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  /**
   * Adds an environment after the project's others. The project row is locked first, so two
   * environments added at the same moment get different positions.
   */
  async create(
    organizationId: string,
    projectId: string,
    input: { name: string; protected: boolean },
  ): Promise<CreateEnvironmentOutcome> {
    try {
      return await this.database.withTenant({ organizationId }, async (tx) => {
        const [project] = await tx
          .select({ id: projects.id })
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
        return { status: 'created', environment: toEnvironment(environment) };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'environments_project_name_key'))
        return { status: 'name_taken' };
      throw error;
    }
  }

  /** Renames an environment of the project, protects or unprotects it, or both. */
  async update(
    organizationId: string,
    projectId: string,
    environmentId: string,
    changes: EnvironmentChanges,
  ): Promise<UpdateEnvironmentOutcome> {
    try {
      const [environment] = await this.database.withTenant({ organizationId }, (tx) =>
        tx
          .update(environments)
          .set({
            ...(changes.name === undefined ? {} : { name: changes.name }),
            ...(changes.protected === undefined ? {} : { protected: changes.protected }),
          })
          .where(
            and(
              eq(environments.organizationId, organizationId),
              eq(environments.projectId, projectId),
              eq(environments.id, environmentId),
            ),
          )
          .returning(),
      );
      return environment
        ? { status: 'updated', environment: toEnvironment(environment) }
        : { status: 'not_found' };
    } catch (error) {
      if (isUniqueViolation(error, 'environments_project_name_key'))
        return { status: 'name_taken' };
      throw error;
    }
  }
}
