import { ErrorCode, OAuthError } from '@forgeflow/contracts';
import { ApiError, NetworkError } from '@/lib/api-client';

/** "45 giây", "15 phút": how long to wait before trying again. */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} giây`;
  return `${Math.ceil(seconds / 60)} phút`;
}

const MESSAGES: Partial<Record<string, string>> = {
  [ErrorCode.InvalidCredentials]: 'Email hoặc mật khẩu không đúng.',
  [ErrorCode.EmailTaken]: 'Email này đã có tài khoản. Hãy đăng nhập.',
  [ErrorCode.InvalidToken]: 'Link không hợp lệ hoặc đã hết hạn. Hãy yêu cầu link mới.',
  [ErrorCode.InvalidPassword]: 'Mật khẩu hiện tại không đúng.',
  [ErrorCode.PasswordNotSet]:
    'Tài khoản chưa có mật khẩu (bạn đăng nhập bằng GitHub). Dùng "Quên mật khẩu" để đặt mật khẩu.',
  [ErrorCode.EmailAlreadyVerified]: 'Email của bạn đã được xác minh.',
  [ErrorCode.EmailNotVerified]: 'Hãy xác minh email của bạn trước (mở link trong hộp thư).',
  [ErrorCode.RoleNotAllowed]: 'Vai trò của bạn không được phép làm việc này.',
  [ErrorCode.LastOwner]:
    'Organization cần ít nhất một chủ sở hữu. Hãy cho người khác làm chủ sở hữu trước.',
  [ErrorCode.AlreadyMember]: 'Người này đã là thành viên của organization.',
  [ErrorCode.InvitationEmailMismatch]: 'Lời mời này được gửi tới một email khác.',
  [ErrorCode.Unauthorized]: 'Phiên đăng nhập đã hết. Hãy đăng nhập lại.',
  [ErrorCode.TokenExpired]: 'Phiên đăng nhập đã hết. Hãy đăng nhập lại.',
  [ErrorCode.OriginNotAllowed]: 'Yêu cầu bị chặn vì không được gửi từ trang ForgeFlow.',
  [ErrorCode.NotFound]: 'Không tìm thấy.',
  [ErrorCode.ValidationFailed]: 'Thông tin nhập chưa hợp lệ.',
  [ErrorCode.ServiceUnavailable]: 'Dịch vụ đang tạm gián đoạn. Thử lại sau ít phút.',
};

const FALLBACK = 'Đã có lỗi xảy ra. Thử lại sau.';

/**
 * The Vietnamese message to show for an error from authApi. `overrides` replaces the message
 * of an error code where the generic one does not fit (e.g. what SERVICE_UNAVAILABLE means on a
 * given page).
 */
export function errorMessage(
  error: unknown,
  overrides: Partial<Record<string, string>> = {},
): string {
  if (error instanceof NetworkError) {
    return 'Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.';
  }
  if (!(error instanceof ApiError)) return FALLBACK;
  const override = overrides[error.code];
  if (override) return override;
  if (error.code === ErrorCode.RateLimited) {
    return error.retryAfterSeconds
      ? `Bạn đã thử quá nhiều lần. Thử lại sau ${formatWait(error.retryAfterSeconds)}.`
      : 'Bạn đã thử quá nhiều lần. Thử lại sau ít phút.';
  }
  return MESSAGES[error.code] ?? FALLBACK;
}

const OAUTH_MESSAGES: Record<OAuthError, string> = {
  [OAuthError.Denied]: 'Bạn đã huỷ đăng nhập bằng GitHub.',
  [OAuthError.StateMismatch]: 'Phiên đăng nhập bằng GitHub không hợp lệ hoặc đã quá hạn. Thử lại.',
  [OAuthError.EmailUnverified]:
    'Tài khoản GitHub chưa có email chính đã xác minh. Xác minh email trên GitHub rồi thử lại.',
  [OAuthError.AccountConflict]:
    'Tài khoản ForgeFlow có email này đã liên kết với một tài khoản GitHub khác.',
  [OAuthError.Failed]: 'Không đăng nhập được bằng GitHub. Thử lại.',
};

/** Message for `?error=<code>` on the login page after a failed GitHub sign-in. */
export function oauthErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return (OAUTH_MESSAGES as Partial<Record<string, string>>)[code] ?? OAUTH_MESSAGES.oauth_failed;
}
