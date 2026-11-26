import { describe, expect, it } from '@jest/globals';
import { loginPathFor, safeNextPath } from '@/features/auth/safe-next';

describe('safeNextPath', () => {
  it('keeps paths on this site, with their query and fragment', () => {
    expect(safeNextPath('/account')).toBe('/account');
    expect(safeNextPath('/projects/42?tab=deploys#latest')).toBe('/projects/42?tab=deploys#latest');
  });

  it('refuses anything that could leave the site', () => {
    for (const next of [
      'https://evil.example/',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'account',
      '',
      null,
      undefined,
    ]) {
      expect(safeNextPath(next)).toBe('/');
    }
  });

  it('uses the given fallback', () => {
    expect(safeNextPath('//evil.example', '/account')).toBe('/account');
  });
});

describe('loginPathFor', () => {
  it('brings the visitor back to where they were', () => {
    expect(loginPathFor('/account')).toBe('/login?next=%2Faccount');
    expect(loginPathFor('/')).toBe('/login');
  });
});
