import {
  authProvidersSchema,
  authUserSchema,
  sessionSchema,
  tokenResponseSchema,
  type ChangePasswordRequest,
  type ForgotPasswordRequest,
  type LoginRequest,
  type RegisterRequest,
  type ResetPasswordRequest,
} from '@forgeflow/contracts';
import { z } from 'zod';
import { apiData, apiRequest, ApiError } from '@/lib/api-client';

const AUTH = '/api/v1/auth';

/** The auth endpoints of the API, one function each. Errors are ApiError / NetworkError. */
export const authApi = {
  providers: () => apiData(`${AUTH}/providers`, authProvidersSchema),

  register: (body: RegisterRequest) =>
    apiData(`${AUTH}/register`, tokenResponseSchema, { method: 'POST', body }),

  login: (body: LoginRequest) =>
    apiData(`${AUTH}/login`, tokenResponseSchema, { method: 'POST', body }),

  /** A new access token from the refresh cookie; null when there is no valid sign-in. */
  refresh: async () => {
    try {
      return await apiData(`${AUTH}/refresh`, tokenResponseSchema, { method: 'POST' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },

  logout: () => apiRequest(`${AUTH}/logout`, { method: 'POST' }),

  me: (accessToken: string) => apiData(`${AUTH}/me`, authUserSchema, { accessToken }),

  verifyEmail: (token: string) =>
    apiRequest(`${AUTH}/verify-email`, { method: 'POST', body: { token } }),

  resendVerification: (accessToken: string) =>
    apiRequest(`${AUTH}/verify-email/resend`, { method: 'POST', accessToken }),

  forgotPassword: (body: ForgotPasswordRequest) =>
    apiRequest(`${AUTH}/password/forgot`, { method: 'POST', body }),

  resetPassword: (body: ResetPasswordRequest) =>
    apiRequest(`${AUTH}/password/reset`, { method: 'POST', body }),

  changePassword: (accessToken: string, body: ChangePasswordRequest) =>
    apiData(`${AUTH}/password/change`, tokenResponseSchema, { method: 'POST', body, accessToken }),

  sessions: (accessToken: string) =>
    apiData(`${AUTH}/sessions`, z.array(sessionSchema), { accessToken }),

  revokeSession: (accessToken: string, id: string) =>
    apiRequest(`${AUTH}/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', accessToken }),

  revokeOtherSessions: (accessToken: string) =>
    apiRequest(`${AUTH}/sessions/revoke-others`, { method: 'POST', accessToken }),

  /** Full-page navigation: the GitHub flow is a chain of redirects, not an API call. */
  githubSignInUrl: `${AUTH}/github`,
};
