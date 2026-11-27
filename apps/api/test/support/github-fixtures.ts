import { readFileSync } from 'node:fs';

export type GithubFixtureName =
  | 'deployment.created'
  | 'deployment_status.created'
  | 'workflow_run.completed'
  | 'installation.deleted'
  | 'installation_repositories.added';

/** Values a test makes its own, so tests running side by side never share ids. */
export interface FixtureIds {
  installationId?: number;
  repositoryId?: number;
  fullName?: string;
  deploymentId?: number;
  statusId?: number;
  runId?: number;
}

type Json = Record<string, unknown>;

/**
 * A webhook payload from test/fixtures/github (shaped like GitHub's documented payloads), with
 * its ids replaced by `ids` and its fields changed by `edit`.
 */
export function githubFixture(
  name: GithubFixtureName,
  ids: FixtureIds = {},
  edit: (payload: Json) => void = () => undefined,
): Json {
  // Parsed afresh on every call: tests may change their copy freely.
  const payload = JSON.parse(
    readFileSync(new URL(`../fixtures/github/${name}.json`, import.meta.url), 'utf8'),
  ) as Json;
  const installation = payload.installation as Json | undefined;
  if (installation && ids.installationId) installation.id = ids.installationId;
  const repository = payload.repository as Json | undefined;
  if (repository) {
    if (ids.repositoryId) repository.id = ids.repositoryId;
    if (ids.fullName) repository.full_name = ids.fullName;
  }
  const deployment = payload.deployment as Json | undefined;
  if (deployment && ids.deploymentId) deployment.id = ids.deploymentId;
  const status = payload.deployment_status as Json | undefined;
  if (status && ids.statusId) status.id = ids.statusId;
  const run = payload.workflow_run as Json | undefined;
  if (run && ids.runId) run.id = ids.runId;
  edit(payload);
  return payload;
}

/** A number no other test picks (ids of installations, repositories, deployments…). */
export function uniqueNumber(): number {
  return 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
}
