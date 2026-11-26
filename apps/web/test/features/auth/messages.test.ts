import { describe, expect, it } from '@jest/globals';
import { ErrorCode, OAuthError } from '@forgeflow/contracts';
import { errorMessage, formatWait, oauthErrorMessage } from '@/features/auth/messages';
import { ApiError, NetworkError } from '@/lib/api-client';

describe('errorMessage', () => {
  it('shows a Vietnamese message for each error code, not the API text', () => {
    const error = new ApiError(
      401,
      ErrorCode.InvalidCredentials,
      'Email or password is incorrect.',
    );
    expect(errorMessage(error)).toBe('Email hoặc mật khẩu không đúng.');
  });

  it('says how long to wait when rate limited', () => {
    expect(errorMessage(new ApiError(429, ErrorCode.RateLimited, 'x', undefined, 840))).toBe(
      'Bạn đã thử quá nhiều lần. Thử lại sau 14 phút.',
    );
    expect(errorMessage(new ApiError(429, ErrorCode.RateLimited, 'x'))).toBe(
      'Bạn đã thử quá nhiều lần. Thử lại sau ít phút.',
    );
  });

  it('tells a network problem apart from an unknown error', () => {
    expect(errorMessage(new NetworkError(new Error('offline')))).toBe(
      'Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.',
    );
    expect(errorMessage(new ApiError(500, 'SOMETHING_NEW', 'x'))).toBe(
      'Đã có lỗi xảy ra. Thử lại sau.',
    );
    expect(errorMessage('not even an error')).toBe('Đã có lỗi xảy ra. Thử lại sau.');
  });

  it('lets a page replace the message of one code', () => {
    const error = new ApiError(503, ErrorCode.ServiceUnavailable, 'x');
    expect(errorMessage(error, { [ErrorCode.ServiceUnavailable]: 'Không gửi được email.' })).toBe(
      'Không gửi được email.',
    );
  });
});

describe('formatWait', () => {
  it('uses seconds under a minute and whole minutes above', () => {
    expect(formatWait(0.2)).toBe('1 giây');
    expect(formatWait(45)).toBe('45 giây');
    expect(formatWait(61)).toBe('2 phút');
    expect(formatWait(900)).toBe('15 phút');
  });
});

describe('oauthErrorMessage', () => {
  it('explains each GitHub sign-in failure, and unknown codes generically', () => {
    expect(oauthErrorMessage(null)).toBeNull();
    expect(oauthErrorMessage(OAuthError.Denied)).toBe('Bạn đã huỷ đăng nhập bằng GitHub.');
    expect(oauthErrorMessage('something_else')).toBe('Không đăng nhập được bằng GitHub. Thử lại.');
  });
});
