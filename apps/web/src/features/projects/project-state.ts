import type { Environment, Project } from '@forgeflow/contracts';

/** `project` with `environment` in place of the one with the same id (renamed, (un)protected). */
export function withEnvironment(project: Project, environment: Environment): Project {
  return {
    ...project,
    environments: project.environments.map((e) => (e.id === environment.id ? environment : e)),
  };
}

/** `project` with a newly added `environment`, which the API places after the others. */
export function withAddedEnvironment(project: Project, environment: Environment): Project {
  return { ...project, environments: [...project.environments, environment] };
}
