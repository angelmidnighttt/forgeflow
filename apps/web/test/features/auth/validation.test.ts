import { describe, expect, it } from '@jest/globals';
import {
  changePasswordRequestSchema,
  ErrorCode,
  loginRequestSchema,
  registerRequestSchema,
} from '@forgeflow/contracts';
import { confirmMatches, fieldErrorsFrom, validate } from '@/features/auth/validation';
import { ApiError } from '@/lib/api-client';

describe('validate', () => {
  it('returns the parsed values, normalized by the contracts schema', () => {
    expect(validate(loginRequestSchema, { email: ' Ann@Example.COM ', password: 'x' })).toEqual({
      ok: true,
      data: { email: 'ann@example.com', password: 'x' },
    });
  });

  it('asks for empty fields by name', () => {
    expect(validate(registerRequestSchema, { name: ' ', email: '', password: '' })).toEqual({
      ok: false,
      errors: { name: 'Nhập tên.', email: 'Nhập email.', password: 'Nhập mật khẩu.' },
    });
  });

  it('explains length and format problems in Vietnamese', () => {
    const result = validate(registerRequestSchema, {
      name: 'Ann',
      email: 'not-an-email',
      password: 'short',
    });
    expect(result).toEqual({
      ok: false,
      errors: { email: 'Email không hợp lệ.', password: 'Mật khẩu cần ít nhất 8 ký tự.' },
    });
  });

  it('names the field in password change messages', () => {
    const result = validate(changePasswordRequestSchema, {
      currentPassword: '',
      newPassword: 'x'.repeat(200),
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        currentPassword: 'Nhập mật khẩu hiện tại.',
        newPassword: 'Mật khẩu mới tối đa 128 ký tự.',
      },
    });
  });
});

describe('fieldErrorsFrom', () => {
  it('turns the details of VALIDATION_FAILED into field messages', () => {
    const error = new ApiError(400, ErrorCode.ValidationFailed, 'Request validation failed.', [
      { path: 'email', message: 'Enter a valid email address.' },
      { path: 'password', message: 'Use at least 8 characters.' },
    ]);
    expect(fieldErrorsFrom(error)).toEqual({
      email: 'Email không hợp lệ.',
      password: 'Mật khẩu không hợp lệ.',
    });
  });

  it('is empty for other errors', () => {
    expect(fieldErrorsFrom(new ApiError(401, ErrorCode.InvalidCredentials, 'x'))).toEqual({});
    expect(fieldErrorsFrom(new Error('x'))).toEqual({});
  });
});

describe('confirmMatches', () => {
  it('checks the repeated password', () => {
    expect(confirmMatches('a long password', '')).toBe('Nhập lại mật khẩu.');
    expect(confirmMatches('a long password', 'a long passwore')).toBe(
      'Mật khẩu nhập lại không khớp.',
    );
    expect(confirmMatches('a long password', 'a long password')).toBeUndefined();
  });
});
