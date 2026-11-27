import type { Environment, Project } from '@forgeflow/contracts';

export type CreateProjectOutcome =
  { status: 'created'; project: Project } | { status: 'name_taken' };

export type RenameProjectOutcome =
  { status: 'renamed'; project: Project } | { status: 'not_found' | 'name_taken' };

export type CreateEnvironmentOutcome =
  { status: 'created'; environment: Environment } | { status: 'project_not_found' | 'name_taken' };

export type UpdateEnvironmentOutcome =
  { status: 'updated'; environment: Environment } | { status: 'not_found' | 'name_taken' };

/** What PATCH …/environments/:environmentId changes; at least one is set. */
export interface EnvironmentChanges {
  name?: string;
  protected?: boolean;
}
