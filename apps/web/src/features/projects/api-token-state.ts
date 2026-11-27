import type { ApiToken } from '@forgeflow/contracts';

export type ApiTokenState = 'active' | 'revoked' | 'expired';

/** Whether a token still works. */
export function apiTokenState(token: ApiToken, now = Date.now()): ApiTokenState {
  if (token.revokedAt) return 'revoked';
  if (token.expiresAt && Date.parse(token.expiresAt) <= now) return 'expired';
  return 'active';
}

export const API_TOKEN_STATE_LABELS: Record<ApiTokenState, string> = {
  active: 'Đang dùng',
  revoked: 'Đã thu hồi',
  expired: 'Hết hạn',
};
