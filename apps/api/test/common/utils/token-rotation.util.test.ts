import { describe, expect, it } from '@jest/globals';
import { TOKEN_POLICY } from '../../../src/common/constants/auth.constants.js';
import {
  decideRotation,
  refreshTokenExpiry,
} from '../../../src/common/utils/token-rotation.util.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-01-01T00:00:00.000Z');

function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs);
}

function token(
  overrides: Partial<Parameters<typeof decideRotation>[0]> = {},
): Parameters<typeof decideRotation>[0] {
  return {
    expiresAt: at(TOKEN_POLICY.refreshIdleMs),
    familyExpiresAt: at(TOKEN_POLICY.refreshAbsoluteMs),
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  };
}

describe('refreshTokenExpiry', () => {
  it('gives a new token the idle limit counted from now', () => {
    expect(refreshTokenExpiry(T0, at(TOKEN_POLICY.refreshAbsoluteMs))).toEqual(
      at(TOKEN_POLICY.refreshIdleMs),
    );
  });

  it('never lets a token outlive its sign-in', () => {
    const familyExpiresAt = at(TOKEN_POLICY.refreshAbsoluteMs);
    const now = new Date(familyExpiresAt.getTime() - DAY_MS);
    expect(refreshTokenExpiry(now, familyExpiresAt)).toEqual(familyExpiresAt);
  });
});

describe('decideRotation', () => {
  it('rotates an active token', () => {
    expect(decideRotation(token(), at(DAY_MS))).toBe('rotate');
  });

  it('refuses a token at or past its idle limit', () => {
    expect(decideRotation(token(), at(TOKEN_POLICY.refreshIdleMs))).toBe('invalid');
  });

  it('refuses a token at or past the end of its sign-in', () => {
    const t = token({ expiresAt: at(40 * DAY_MS) });
    expect(decideRotation(t, at(TOKEN_POLICY.refreshAbsoluteMs))).toBe('invalid');
  });

  it('treats a replaced token shown again within the grace window as a race between tabs', () => {
    const replaced = token({ revokedAt: T0, revokedReason: 'rotated' });
    expect(decideRotation(replaced, at(TOKEN_POLICY.refreshReuseGraceMs))).toBe('conflict');
  });

  it('treats a replaced token shown again after the grace window as stolen', () => {
    const replaced = token({ revokedAt: T0, revokedReason: 'rotated' });
    expect(decideRotation(replaced, at(TOKEN_POLICY.refreshReuseGraceMs + 1))).toBe(
      'reuse_detected',
    );
  });

  it('refuses tokens revoked by sign-out or by a theft response', () => {
    expect(decideRotation(token({ revokedAt: T0, revokedReason: 'logout' }), T0)).toBe('invalid');
    expect(decideRotation(token({ revokedAt: T0, revokedReason: 'reuse_detected' }), T0)).toBe(
      'invalid',
    );
  });
});
