'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The `token` from the URL fragment of an emailed link (`/reset-password#token=…`): undefined
 * while not read yet, null when the link has none. The fragment is then removed from the
 * address bar and history, so the token does not linger where someone could copy it.
 */
export function useTokenFromHash(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  // Strict Mode runs effects twice in development; the second run must not read the
  // already-cleared fragment and report "no token".
  const read = useRef(false);

  useEffect(() => {
    if (read.current) return;
    read.current = true;
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    setToken(value && value.trim() ? value.trim() : null);
  }, []);

  return token;
}
