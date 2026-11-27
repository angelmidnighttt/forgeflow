import { describe, expect, it } from '@jest/globals';
import {
  DEPLOYMENT_STATUSES,
  GITHUB_SETUP_ERRORS,
  type ApiToken,
  type DeploymentStatus,
} from '@forgeflow/contracts';
import {
  commitUrl,
  DEPLOYMENT_STATUS_LABELS,
  deploymentStatusVariant,
  formatDuration,
  githubSetupErrorMessage,
  safeHref,
} from '@/features/integrations/labels';
import { API_TOKEN_STATE_LABELS, apiTokenState } from '@/features/projects/api-token-state';

describe('GitHub setup errors', () => {
  it('explains every error the API can send back', () => {
    for (const code of GITHUB_SETUP_ERRORS) {
      expect(githubSetupErrorMessage(code)).toEqual(expect.any(String));
    }
  });

  it('says nothing without an error, and something generic for an unknown one', () => {
    expect(githubSetupErrorMessage(null)).toBeNull();
    expect(githubSetupErrorMessage('')).toBeNull();
    expect(githubSetupErrorMessage('toString')).toBe('Kết nối GitHub không thành công.');
    expect(githubSetupErrorMessage('something_new')).toBe('Kết nối GitHub không thành công.');
  });
});

describe('deployment status', () => {
  it('has a label for every status', () => {
    for (const status of DEPLOYMENT_STATUSES) {
      expect(DEPLOYMENT_STATUS_LABELS[status]).toEqual(expect.any(String));
    }
  });

  it('makes problems stand out', () => {
    const variant = (status: DeploymentStatus) => deploymentStatusVariant(status);
    expect(variant('failure')).toBe('destructive');
    expect(variant('error')).toBe('destructive');
    expect(variant('success')).toBe('default');
    expect(variant('in_progress')).toBe('secondary');
    expect(variant('cancelled')).toBe('outline');
    expect(variant('inactive')).toBe('outline');
  });
});

describe('formatDuration', () => {
  it.each([
    [null, '—'],
    [0, '0 giây'],
    [45, '45 giây'],
    [60, '1 phút'],
    [200, '3 phút 20 giây'],
    [3600, '1 giờ'],
    [3900, '1 giờ 5 phút'],
    [3959, '1 giờ 5 phút'],
  ])('%p seconds is "%s"', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});

describe('commitUrl', () => {
  it('links a commit of a GitHub repository', () => {
    expect(commitUrl('acme/shop', 'abc1234')).toBe('https://github.com/acme/shop/commit/abc1234');
  });

  it('has no link without a repository, a SHA, or with a name that is not owner/repo', () => {
    expect(commitUrl(null, 'abc1234')).toBeNull();
    expect(commitUrl('acme/shop', null)).toBeNull();
    expect(commitUrl('acme/shop/../../evil', 'abc1234')).toBeNull();
    expect(commitUrl('https://evil.example', 'abc1234')).toBeNull();
  });
});

describe('safeHref', () => {
  it('keeps http(s) links', () => {
    expect(safeHref('https://ci.example.com/jobs/1?x=1')).toBe('https://ci.example.com/jobs/1?x=1');
    expect(safeHref('http://jenkins.internal:8080/job/2')).toBe(
      'http://jenkins.internal:8080/job/2',
    );
  });

  it('drops links that could run script or are not links at all', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref(' JavaScript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHref('/relative/path')).toBeNull();
    expect(safeHref('')).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });
});

describe('API token state', () => {
  const now = Date.parse('2026-11-27T12:00:00.000Z');
  const token = (changes: Partial<ApiToken> = {}): ApiToken => ({
    id: '00000000-0000-4000-8000-000000000001',
    name: 'CI',
    prefix: 'ffp_AbCd',
    scopes: ['deployments:write'],
    createdBy: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    ...changes,
  });

  it('is active until it expires or is revoked', () => {
    expect(apiTokenState(token(), now)).toBe('active');
    expect(apiTokenState(token({ expiresAt: '2026-11-28T00:00:00.000Z' }), now)).toBe('active');
    expect(apiTokenState(token({ expiresAt: '2026-11-27T12:00:00.000Z' }), now)).toBe('expired');
    expect(
      apiTokenState(
        token({ expiresAt: '2026-11-20T00:00:00.000Z', revokedAt: '2026-11-10T00:00:00.000Z' }),
        now,
      ),
    ).toBe('revoked');
  });

  it('has a label for every state', () => {
    expect(Object.keys(API_TOKEN_STATE_LABELS).sort()).toEqual(['active', 'expired', 'revoked']);
  });
});
