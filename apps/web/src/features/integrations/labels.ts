import type { DeploymentStatus, GithubSetupError, OutboxEvent } from '@forgeflow/contracts';

/** Why connecting the GitHub App failed (?github_error= on the way back from GitHub). */
export const GITHUB_SETUP_ERROR_MESSAGES: Record<GithubSetupError, string> = {
  state:
    'Phiên kết nối đã hết hạn hoặc được mở ở trình duyệt khác. Hãy bấm "Kết nối GitHub" lại từ trang này.',
  authorization:
    'GitHub không gửi xác nhận người dùng. GitHub App cần bật "Request user authorization (OAuth) during installation".',
  not_yours: 'Tài khoản GitHub của bạn không có quyền với bản cài đặt này.',
  forbidden: 'Bạn không còn quyền quản lý tích hợp của organization này.',
  taken: 'Bản cài đặt GitHub này đã được kết nối với một organization khác.',
  github: 'Không liên lạc được với GitHub. Thử lại sau ít phút.',
};

export function githubSetupErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(GITHUB_SETUP_ERROR_MESSAGES, code)
    ? GITHUB_SETUP_ERROR_MESSAGES[code as GithubSetupError]
    : 'Kết nối GitHub không thành công.';
}

export const DEPLOYMENT_STATUS_LABELS: Record<DeploymentStatus, string> = {
  queued: 'Đang chờ',
  in_progress: 'Đang chạy',
  success: 'Thành công',
  failure: 'Thất bại',
  error: 'Lỗi',
  cancelled: 'Đã huỷ',
  inactive: 'Đã thay thế',
};

/** How a status badge looks: problems stand out, the rest stays quiet. */
export function deploymentStatusVariant(
  status: DeploymentStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failure' || status === 'error') return 'destructive';
  if (status === 'success') return 'default';
  if (status === 'in_progress' || status === 'queued') return 'secondary';
  return 'outline';
}

export const EVENT_STATUS_LABELS: Record<OutboxEvent['status'], string> = {
  pending: 'Đang chờ xử lý',
  processing: 'Đang xử lý',
  done: 'Đã xử lý',
  dead: 'Lỗi, đã dừng thử',
};

/** "45 giây", "3 phút 20 giây", "1 giờ 5 phút". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds} giây`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest ? `${minutes} phút ${rest} giây` : `${minutes} phút`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
}

/** The GitHub page of a commit, when the deployment came from a GitHub repository. */
export function commitUrl(repository: string | null, sha: string | null): string | null {
  if (!repository || !sha || !/^[\w.-]+\/[\w.-]+$/.test(repository)) return null;
  return `https://github.com/${repository}/commit/${sha}`;
}

/**
 * A link from outside data (a pipeline's log URL, GitHub's target_url) that is safe to put in
 * href: http(s) only, so a reported "javascript:" URL never becomes a link.
 */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}
