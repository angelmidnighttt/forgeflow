import type { DeploymentStatus } from '@forgeflow/contracts';

/** Statuses after which a deployment no longer changes on its own. */
export const FINISHED_STATUSES: ReadonlySet<DeploymentStatus> = new Set([
  'success',
  'failure',
  'error',
  'cancelled',
  'inactive',
]);

/** A GitHub deployment status `state`. */
export function statusOfGithubState(state: string): DeploymentStatus {
  switch (state) {
    case 'in_progress':
      return 'in_progress';
    case 'success':
      return 'success';
    case 'failure':
      return 'failure';
    case 'error':
      return 'error';
    case 'inactive':
      return 'inactive';
    default:
      // pending, queued, and anything GitHub adds later.
      return 'queued';
  }
}

/** A GitHub Actions run's `status` and, once completed, its `conclusion`. */
export function statusOfWorkflowRun(
  status: string,
  conclusion: string | null | undefined,
): DeploymentStatus {
  if (status === 'in_progress') return 'in_progress';
  if (status !== 'completed') return 'queued';
  switch (conclusion) {
    case 'success':
    case 'neutral':
      return 'success';
    case 'failure':
    case 'timed_out':
      return 'failure';
    case 'cancelled':
    case 'skipped':
    case 'stale':
      return 'cancelled';
    case 'action_required':
      return 'queued';
    default:
      // startup_failure, and anything GitHub adds later.
      return 'error';
  }
}

/** A readable version: the ref when it is a tag or branch name, else the short commit. */
export function versionOf(
  ref: string | null | undefined,
  sha: string | null | undefined,
): string | null {
  if (ref && !/^[0-9a-f]{40}$/i.test(ref)) return ref;
  return sha ? sha.slice(0, 7) : null;
}
