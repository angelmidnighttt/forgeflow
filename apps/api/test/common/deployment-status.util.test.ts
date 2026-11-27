import { describe, expect, it } from '@jest/globals';
import {
  statusOfGithubState,
  statusOfWorkflowRun,
  versionOf,
} from '../../src/common/utils/deployment-status.util.js';
import {
  githubSignature,
  isValidGithubSignature,
} from '../../src/common/utils/webhook-signature.util.js';

describe('deployment statuses', () => {
  it("map GitHub's deployment states", () => {
    expect(
      ['pending', 'queued', 'in_progress', 'success', 'failure', 'error', 'inactive', 'new'].map(
        statusOfGithubState,
      ),
    ).toEqual([
      'queued',
      'queued',
      'in_progress',
      'success',
      'failure',
      'error',
      'inactive',
      'queued',
    ]);
  });

  it('map Actions runs by status, then conclusion', () => {
    expect(statusOfWorkflowRun('requested', null)).toBe('queued');
    expect(statusOfWorkflowRun('in_progress', null)).toBe('in_progress');
    const completed = (conclusion: string) => statusOfWorkflowRun('completed', conclusion);
    expect(
      ['success', 'neutral', 'failure', 'timed_out', 'cancelled', 'skipped', 'startup_failure'].map(
        completed,
      ),
    ).toEqual(['success', 'success', 'failure', 'failure', 'cancelled', 'cancelled', 'error']);
  });

  it('name a version after the tag or branch, else the short commit', () => {
    expect(versionOf('v1.2.3', 'abcdef1234567890abcdef1234567890abcdef12')).toBe('v1.2.3');
    expect(
      versionOf(
        'abcdef1234567890abcdef1234567890abcdef12',
        'abcdef1234567890abcdef1234567890abcdef12',
      ),
    ).toBe('abcdef1');
    expect(versionOf(null, null)).toBeNull();
  });
});

describe('GitHub webhook signatures', () => {
  const body = Buffer.from('{"zen":"Design for failure."}');
  it('accept the HMAC of the exact body, and nothing else', () => {
    const signature = githubSignature('s3cret-webhook-key', body);
    expect(isValidGithubSignature('s3cret-webhook-key', body, signature)).toBe(true);
    expect(isValidGithubSignature('another-key', body, signature)).toBe(false);
    expect(isValidGithubSignature('s3cret-webhook-key', Buffer.from(`${body} `), signature)).toBe(
      false,
    );
    for (const bad of [
      undefined,
      '',
      'sha256=',
      'sha256=zz',
      signature.replace('sha256=', 'sha1='),
    ]) {
      expect(isValidGithubSignature('s3cret-webhook-key', body, bad)).toBe(false);
    }
  });
});
