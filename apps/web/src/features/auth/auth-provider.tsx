'use client';

import { ErrorCode, type AuthUser, type TokenResponse } from '@forgeflow/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from '@/lib/api-client';
import { authApi } from './auth-api';

export type AuthState =
  /** Checking the refresh cookie on page load. */
  | { status: 'loading' }
  | { status: 'signed_out' }
  /** The API could not be reached to check the sign-in. */
  | { status: 'unavailable' }
  | { status: 'signed_in'; user: AuthUser };

interface AuthContextValue {
  state: AuthState;
  /** Starts using the tokens returned by login, sign-up or a password change. */
  acceptSignIn(tokens: TokenResponse): void;
  /** Runs `call` with a valid access token, refreshing it once if it has expired. */
  withAccessToken<T>(call: (accessToken: string) => Promise<T>): Promise<T>;
  /** Reads the user again, e.g. after the email was verified. */
  reloadUser(): Promise<void>;
  /** Signs out on the server, then in this tab and the others. */
  signOut(): Promise<void>;
  /** Forgets the sign-in without calling the API, which already ended it (password reset). */
  forgetSignIn(): void;
  /** Checks the sign-in again after `unavailable`. */
  retry(): void;
}

interface Session {
  accessToken: string;
  expiresAt: number;
  user: AuthUser;
}

/** Refresh this long before the access token expires, so calls rarely meet TOKEN_EXPIRED. */
const REFRESH_EARLY_MS = 60_000;
/** Tells the other tabs of this browser that the sign-in changed. */
const CHANNEL_NAME = 'forgeflow-auth';
/** Web Locks name that serializes refreshes across tabs. */
const REFRESH_LOCK = 'forgeflow-refresh';

let refreshing: Promise<TokenResponse | null> | null = null;

/**
 * Exchanges the refresh cookie for a new access token, one refresh at a time: within a tab
 * through the shared promise, across tabs through the Web Locks API. Every refresh replaces the
 * cookie, so two tabs presenting the same one at once would get 409 from the API.
 */
function refreshOnce(): Promise<TokenResponse | null> {
  refreshing ??= runRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function runRefresh(): Promise<TokenResponse | null> {
  const attempt = async () => {
    try {
      return await authApi.refresh();
    } catch (error) {
      // Refreshed by another tab a moment ago (browsers without Web Locks); its response
      // already stored the new cookie, so trying again uses that one.
      if (error instanceof ApiError && error.code === ErrorCode.Conflict) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return authApi.refresh();
      }
      throw error;
    }
  };
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    return navigator.locks.request(REFRESH_LOCK, attempt);
  }
  return attempt();
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds the sign-in of this tab. The access token lives only in memory (never in storage a
 * script could read later); on page load it is rebuilt from the HttpOnly refresh cookie.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const session = useRef<Session | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const apply = useCallback((tokens: TokenResponse | null) => {
    clearTimeout(timer.current);
    if (!tokens) {
      session.current = null;
      setState({ status: 'signed_out' });
      return;
    }
    const expiresAt = Date.parse(tokens.expiresAt);
    session.current = { accessToken: tokens.accessToken, expiresAt, user: tokens.user };
    setState({ status: 'signed_in', user: tokens.user });
    timer.current = setTimeout(
      () => {
        refreshOnce().then(apply, () => {
          // Offline for now: the next API call refreshes again or signs out.
        });
      },
      Math.max(0, expiresAt - Date.now() - REFRESH_EARLY_MS),
    );
  }, []);

  const check = useCallback(() => {
    setState({ status: 'loading' });
    refreshOnce().then(apply, () => setState({ status: 'unavailable' }));
  }, [apply]);

  useEffect(() => {
    check();
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel(CHANNEL_NAME);
    channel.current = bc;
    bc.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === 'signed_out') apply(null);
      // Another tab signed in: the cookie this browser holds belongs to that sign-in now.
      if (event.data === 'signed_in') refreshOnce().then(apply, () => {});
    };
    return () => {
      bc.close();
      channel.current = null;
      clearTimeout(timer.current);
    };
  }, [check, apply]);

  const withAccessToken = useCallback(
    async <T,>(call: (accessToken: string) => Promise<T>): Promise<T> => {
      let current = session.current;
      if (!current || current.expiresAt - Date.now() < 5_000) {
        const tokens = await refreshOnce();
        apply(tokens);
        if (!tokens) throw new ApiError(401, ErrorCode.Unauthorized, 'Sign in to continue.');
        current = { accessToken: tokens.accessToken, expiresAt: 0, user: tokens.user };
      }
      try {
        return await call(current.accessToken);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        const tokens = await refreshOnce();
        apply(tokens);
        if (!tokens) throw error;
        return call(tokens.accessToken);
      }
    },
    [apply],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      acceptSignIn(tokens) {
        apply(tokens);
        channel.current?.postMessage('signed_in');
      },
      withAccessToken,
      async reloadUser() {
        const user = await withAccessToken((token) => authApi.me(token));
        if (session.current) session.current.user = user;
        setState({ status: 'signed_in', user });
      },
      async signOut() {
        try {
          await authApi.logout();
        } finally {
          apply(null);
          channel.current?.postMessage('signed_out');
        }
      },
      forgetSignIn() {
        apply(null);
        channel.current?.postMessage('signed_out');
      },
      retry: check,
    }),
    [state, apply, withAccessToken, check],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** The signed-in user, for components rendered inside <RequireAuth>. */
export function useSignedInUser(): AuthUser {
  const { state } = useAuth();
  if (state.status !== 'signed_in') throw new Error('useSignedInUser needs a signed-in user');
  return state.user;
}
