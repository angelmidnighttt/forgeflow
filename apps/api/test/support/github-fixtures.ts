import { readFileSync } from 'node:fs';

export type GithubFixtureName =
  | 'deployment.created'
  | 'deployment_status.created'
  | 'workflow_run.completed'
  | 'installation.created'
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
 * A webhook payload from test/fixtures/github, with its ids replaced by `ids` and its fields
 * changed by `edit`. The fixtures are real: webhooks GitHub sent to staging (workflow_run,
 * installation) and real deployment objects from its API inside a real webhook's envelope
 * (deployment, deployment_status), with the account, emails, names, commit messages and the
 * server's address replaced. installation.deleted is the real install payload with its action
 * changed; installation_repositories.added follows GitHub's documented payload. The contract
 * test (github-payloads.test.ts) checks every one.
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
