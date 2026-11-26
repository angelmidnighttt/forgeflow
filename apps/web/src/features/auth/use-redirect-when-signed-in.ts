'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from './auth-provider';

/**
 * Leaves the login / sign-up page for `next` as soon as there is a sign-in: right after the
 * form succeeds, or straight away when the visitor was already signed in.
 */
export function useRedirectWhenSignedIn(next: string): void {
  const { state } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (state.status === 'signed_in') router.replace(next);
  }, [state.status, router, next]);
}
