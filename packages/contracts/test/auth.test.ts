import { describe, expect, it } from '@jest/globals';
import { emailSchema, loginRequestSchema, registerRequestSchema } from '../src/auth.js';

describe('emailSchema', () => {
  it('trims and lowercases before checking the format', () => {
    expect(emailSchema.parse('  Ann.Lee@Example.COM ')).toBe('ann.lee@example.com');
  });

  it('rejects addresses that are malformed or too long', () => {
    expect(emailSchema.safeParse('ann@').success).toBe(false);
    expect(emailSchema.safeParse(`${'a'.repeat(250)}@x.io`).success).toBe(false);
  });
});

describe('registerRequestSchema', () => {
  const valid = { email: 'ann@example.com', password: 'eight chr', name: ' Ann ' };

  it('accepts a valid sign-up and trims the name', () => {
    expect(registerRequestSchema.parse(valid)).toEqual({ ...valid, name: 'Ann' });
  });

  it('enforces 8 to 128 characters and keeps the password exactly as typed', () => {
    expect(registerRequestSchema.safeParse({ ...valid, password: '7 chars' }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...valid, password: 'x'.repeat(129) }).success).toBe(
      false,
    );
    expect(registerRequestSchema.parse({ ...valid, password: '  spaced  ' }).password).toBe(
      '  spaced  ',
    );
  });
});

describe('loginRequestSchema', () => {
  it('does not apply the sign-up length rule to the password', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.io', password: 'short' }).success).toBe(true);
    expect(loginRequestSchema.safeParse({ email: 'a@b.io', password: '' }).success).toBe(false);
  });
});
