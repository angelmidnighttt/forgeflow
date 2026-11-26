import { describe, expect, it } from '@jest/globals';
import { describeUserAgent } from '@/features/account/describe-user-agent';
import { formatRelative } from '@/features/account/format-time';

describe('describeUserAgent', () => {
  it('names common browsers and systems', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome trên Windows');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      ),
    ).toBe('Edge trên Windows');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari trên iOS');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome trên Android');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0',
      ),
    ).toBe('Firefox trên macOS');
  });

  it('falls back to the raw value, shortened, or to "unknown"', () => {
    expect(describeUserAgent(null)).toBe('Thiết bị không rõ');
    expect(describeUserAgent('curl/8.10.1')).toBe('curl/8.10.1');
    expect(describeUserAgent('x'.repeat(60))).toBe(`${'x'.repeat(40)}…`);
  });
});

describe('formatRelative', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');

  it('says "just now" under a minute and picks the largest unit above', () => {
    expect(formatRelative('2026-11-26T11:59:30Z', now)).toBe('vừa xong');
    expect(formatRelative('2026-11-26T11:55:00Z', now)).toBe('5 phút trước');
    expect(formatRelative('2026-11-26T09:00:00Z', now)).toBe('3 giờ trước');
    expect(formatRelative('2026-11-25T12:00:00Z', now)).toBe('hôm qua');
  });
});
