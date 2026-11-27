import { describe, expect, it } from '@jest/globals';
import { redactRequestLog, redactUrl } from '../../src/common/utils/log-redaction.util.js';

describe('redactUrl', () => {
  it('censors OAuth codes, states and tokens, and keeps the rest as it was', () => {
    expect(
      redactUrl(
        '/api/v1/github/setup?code=abc123&installation_id=42&setup_action=install&state=eyJ.x.y',
      ),
    ).toBe(
      '/api/v1/github/setup?code=[REDACTED]&installation_id=42&setup_action=install&state=[REDACTED]',
    );
    expect(redactUrl('/api/v1/auth/github/callback?STATE=a&Code=b&x=%20y')).toBe(
      '/api/v1/auth/github/callback?STATE=[REDACTED]&Code=[REDACTED]&x=%20y',
    );
    expect(redactUrl('/x?access%5Ftoken=t&refresh_token=r&client_secret=s&token=k')).toBe(
      '/x?access%5Ftoken=[REDACTED]&refresh_token=[REDACTED]&client_secret=[REDACTED]&token=[REDACTED]',
    );
  });

  it('leaves URLs without secret parameters alone', () => {
    expect(redactUrl('/api/v1/health')).toBe('/api/v1/health');
    expect(redactUrl('/api/v1/deployments?status=success&cursor=abc')).toBe(
      '/api/v1/deployments?status=success&cursor=abc',
    );
    expect(redactUrl('/x?%E0%A4%A=1')).toBe('/x?%E0%A4%A=1');
    expect(redactUrl(undefined)).toBeUndefined();
  });
});

describe('redactRequestLog', () => {
  it('censors the parsed query too, keeping the other fields', () => {
    const logged = redactRequestLog({
      id: 'req-1',
      method: 'GET',
      url: '/api/v1/github/setup?code=abc&installation_id=1',
      query: { code: 'abc', installation_id: '1' },
      headers: { host: 'forgeflow.test' },
    });
    expect(logged).toEqual({
      id: 'req-1',
      method: 'GET',
      url: '/api/v1/github/setup?code=[REDACTED]&installation_id=1',
      query: { code: '[REDACTED]', installation_id: '1' },
      headers: { host: 'forgeflow.test' },
    });
  });
});
