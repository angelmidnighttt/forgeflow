import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_ENVIRONMENTS, type Environment, type Project } from '@forgeflow/contracts';
import {
  environments,
  projects,
  type DatabaseHandle,
  type DbExecutor,
  type EnvironmentRow,
  type ProjectRow,
} from '@forgeflow/database';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DATABASE } from '../../common/constants/injection-tokens.js';
import type { AuditActor } from '../../common/types/audit.types.js';
import type {
  CreateProjectOutcome,
  RenameProjectOutcome,
} from '../../common/types/project.types.js';
import { isUniqueViolation } from '../../common/utils/pg-error.util.js';
import { AuditService } from '../audit/audit.service.js';

/**
 * Projects of an organization, each with its environments. Every query runs in the
 * organization's tenant context (row-level security, docs/adr/ADR-0002); the explicit
 * organization filters are kept anyway, so a query reads the same with or without RLS.
 */
@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Creates a project with the default environments (DEFAULT_ENVIRONMENTS), in one transaction. */
  async create(
    organizationId: string,
    name: string,
    actor: AuditActor,
  ): Promise<CreateProjectOutcome> {
    try {
      return await this.database.withTenant({ organizationId }, async (tx) => {
        const [project] = await tx.insert(projects).values({ organizationId, name }).returning();
        if (!project) throw new Error('Project insert returned no row');
        const created = await tx
          .insert(environments)
          .values(
            DEFAULT_ENVIRONMENTS.map((environment, position) => ({
              organizationId,
              projectId: project.id,
              name: environment.name,
              protected: environment.protected,
              position,
            })),
          )
          .returning();
        await this.audit.record(tx, {
          organizationId,
          actor,
          action: 'project.created',
          target: { type: 'project', id: project.id },
          metadata: { name },
        });
        return { status: 'created', project: toProject(project, created) };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'projects_organization_name_key'))
        return { status: 'name_taken' };
      throw error;
    }
  }

  /** The organization's projects by name, each with its environments. */
  async list(organizationId: string): Promise<Project[]> {
    return this.database.withTenant({ organizationId }, async (tx) => {
      const rows = await tx
        .select()
        .from(projects)
        .where(eq(projects.organizationId, organizationId))
        .orderBy(asc(sql`lower(${projects.name})`), asc(projects.createdAt));
      const byProject = await this.environmentsOf(
        tx,
        organizationId,
        rows.map((row) => row.id),
      );
      return rows.map((row) => toProject(row, byProject.get(row.id) ?? []));
    });
  }

  async get(organizationId: string, projectId: string): Promise<Project | undefined> {
    return this.database.withTenant({ organizationId }, async (tx) => {
      const [row] = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)))
        .limit(1);
      if (!row) return undefined;
      const byProject = await this.environmentsOf(tx, organizationId, [row.id]);
      return toProject(row, byProject.get(row.id) ?? []);
    });
  }

  async rename(
    organizationId: string,
    projectId: string,
    name: string,
    actor: AuditActor,
  ): Promise<RenameProjectOutcome> {
    try {
      return await this.database.withTenant({ organizationId }, async (tx) => {
        const [before] = await tx
          .select({ name: projects.name })
          .from(projects)
          .where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)))
          .for('update');
        if (!before) return { status: 'not_found' };
        const [row] = await tx
          .update(projects)
          .set({ name })
          .where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)))
          .returning();
        if (!row) return { status: 'not_found' };
        if (before.name !== name) {
          await this.audit.record(tx, {
            organizationId,
            actor,
            action: 'project.renamed',
            target: { type: 'project', id: projectId },
            metadata: { from: before.name, to: name },
          });
        }
        const byProject = await this.environmentsOf(tx, organizationId, [row.id]);
        return { status: 'renamed', project: toProject(row, byProject.get(row.id) ?? []) };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'projects_organization_name_key'))
        return { status: 'name_taken' };
      throw error;
    }
  }

  /** The environments of `projectIds`, grouped by project. */
  private async environmentsOf(
    db: DbExecutor,
    organizationId: string,
    projectIds: string[],
  ): Promise<Map<string, EnvironmentRow[]>> {
    const byProject = new Map<string, EnvironmentRow[]>();
    if (projectIds.length === 0) return byProject;
    const rows = await db
      .select()
      .from(environments)
      .where(
        and(
          eq(environments.organizationId, organizationId),
          inArray(environments.projectId, projectIds),
        ),
      );
    for (const row of rows) {
      const list = byProject.get(row.projectId) ?? [];
      list.push(row);
      byProject.set(row.projectId, list);
    }
    return byProject;
  }
}

/** Environments in display order: by position, then the order they were added. */
export function byPosition(a: EnvironmentRow, b: EnvironmentRow): number {
  return (
    a.position - b.position ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

export function toEnvironment(row: EnvironmentRow): Environment {
  return {
    id: row.id,
    name: row.name,
    protected: row.protected,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toProject(row: ProjectRow, environmentRows: EnvironmentRow[]): Project {
  return {
    id: row.id,
    name: row.name,
    environments: [...environmentRows].sort(byPosition).map(toEnvironment),
    createdAt: row.createdAt.toISOString(),
  };
}
