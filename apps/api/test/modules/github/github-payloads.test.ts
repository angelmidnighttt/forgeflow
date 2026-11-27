import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { DEPLOYMENT_STATUSES } from '@forgeflow/contracts';
import { z } from 'zod';
import type {
  GithubDeployment,
  GithubDeploymentStatus,
  GithubRepository,
  GithubWorkflowRun,
} from '../../../src/common/types/github.types.js';
import {
  statusOfGithubState,
  statusOfWorkflowRun,
  versionOf,
} from '../../../src/common/utils/deployment-status.util.js';

/**
 * The contract with GitHub: what ForgeFlow reads from each webhook it handles, with the types it
 * expects. Every fixture in test/fixtures/github (real payloads, personal data replaced) must
 * keep to it, so a payload GitHub changes, or a field the code starts relying on, shows up here.
 */
const timestamp = z.iso.datetime({ offset: true });
const user = z.object({ login: z.string().min(1) });
const repository = z.object({
  id: z.number().int().positive(),
  full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  html_url: z.url().optional(),
  default_branch: z.string().nullable().optional(),
  private: z.boolean(),
});
const installationRef = z.object({ id: z.number().int().positive() });
const deployment = z.object({
  id: z.number().int().positive(),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  ref: z.string().min(1),
  environment: z.string().min(1),
  description: z.string().nullable().optional(),
  creator: user.nullable().optional(),
  created_at: timestamp,
  updated_at: timestamp.optional(),
});
const deploymentStatus = z.object({
  id: z.number().int().positive(),
  state: z.string().min(1),
  description: z.string().nullable().optional(),
  environment_url: z.string().nullable().optional(),
  log_url: z.string().nullable().optional(),
  target_url: z.string().nullable().optional(),
  creator: user.nullable().optional(),
  created_at: timestamp,
});
const workflowRun = z.object({
  id: z.number().int().positive(),
  name: z.string().nullable().optional(),
  head_branch: z.string().nullable().optional(),
  head_sha: z.string().regex(/^[0-9a-f]{40}$/),
  status: z.string().min(1),
  conclusion: z.string().nullable().optional(),
  html_url: z.url(),
  run_number: z.number().int().positive().optional(),
  event: z.string().optional(),
  actor: user.nullable().optional(),
  triggering_actor: user.nullable().optional(),
  created_at: timestamp,
  run_started_at: timestamp.nullable().optional(),
  updated_at: timestamp,
});

// The code's types must be satisfiable from what the contract guarantees.
const asRepository = (r: z.infer<typeof repository>): GithubRepository => r;
const asDeployment = (d: z.infer<typeof deployment>): GithubDeployment => d;
const asStatus = (s: z.infer<typeof deploymentStatus>): GithubDeploymentStatus => s;
const asRun = (r: z.infer<typeof workflowRun>): GithubWorkflowRun => r;
void [asRepository, asDeployment, asStatus, asRun];

const CONTRACTS: Record<string, z.ZodType> = {
  deployment: z.object({
    action: z.literal('created'),
    deployment,
    repository,
    installation: installationRef,
  }),
  deployment_status: z.object({
    action: z.literal('created'),
    deployment_status: deploymentStatus,
    deployment,
    repository,
    installation: installationRef,
  }),
  workflow_run: z.object({
    action: z.enum(['requested', 'in_progress', 'completed']),
    workflow_run: workflowRun,
    repository,
    installation: installationRef,
  }),
  installation: z.object({
    action: z.enum(['created', 'deleted', 'suspend', 'unsuspend', 'new_permissions_accepted']),
    installation: z.object({
      id: z.number().int().positive(),
      account: z.object({ login: z.string(), type: z.string() }).nullable(),
    }),
    repositories: z.array(repository.pick({ id: true, full_name: true, private: true })).optional(),
  }),
  installation_repositories: z.object({
    action: z.enum(['added', 'removed']),
    installation: installationRef,
    repositories_added: z.array(repository.pick({ id: true, full_name: true, private: true })),
    repositories_removed: z.array(repository.pick({ id: true, full_name: true })),
  }),
};

const directory = new URL('../../fixtures/github/', import.meta.url);
const fixtures = readdirSync(directory)
  .filter((file) => file.endsWith('.json'))
  .map((file) => {
    const [event, action] = file.replace(/\.json$/, '').split('.');
    const payload = JSON.parse(readFileSync(new URL(file, directory), 'utf8')) as Record<
      string,
      unknown
    >;
    return { file, event: event!, action: action!, payload };
  });

describe('GitHub webhook payloads', () => {
  it('has a fixture for every event ForgeFlow handles', () => {
    expect(new Set(fixtures.map((f) => f.event))).toEqual(new Set(Object.keys(CONTRACTS)));
  });

  it.each(fixtures.map((f) => [f.file, f] as const))('%s keeps to the contract', (_, fixture) => {
    expect(fixture.payload.action).toBe(fixture.action);
    const contract = CONTRACTS[fixture.event];
    expect(contract).toBeDefined();
    const result = contract!.safeParse(fixture.payload);
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it('maps the real statuses to ForgeFlow statuses, and names a version', () => {
    for (const { event, payload } of fixtures) {
      if (event === 'deployment_status') {
        const status = payload.deployment_status as GithubDeploymentStatus;
        expect(DEPLOYMENT_STATUSES).toContain(statusOfGithubState(status.state));
      }
      if (event === 'workflow_run') {
        const run = payload.workflow_run as GithubWorkflowRun;
        expect(DEPLOYMENT_STATUSES).toContain(statusOfWorkflowRun(run.status, run.conclusion));
      }
      if (event === 'deployment') {
        const d = payload.deployment as GithubDeployment;
        expect(versionOf(d.ref, d.sha)).toEqual(expect.any(String));
      }
    }
  });
});
