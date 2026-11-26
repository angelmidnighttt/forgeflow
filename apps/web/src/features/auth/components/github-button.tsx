'use client';

import type { AuthProviders } from '@forgeflow/contracts';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldSeparator } from '@/components/ui/field';
import { authApi } from '../auth-api';

let providersRequest: Promise<AuthProviders> | null = null;

/** Which sign-in methods the API has turned on; asked once per page load. */
function useAuthProviders(): AuthProviders | null {
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  useEffect(() => {
    providersRequest ??= authApi.providers().catch(() => ({ github: false }));
    let active = true;
    void providersRequest.then((value) => {
      if (active) setProviders(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return providers;
}

/** The GitHub mark, as GitHub's logo guidelines allow for "Sign in with GitHub" buttons. */
function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/**
 * "Sign in with GitHub", shown only when the API has it configured. It is a plain link: the
 * GitHub flow is a chain of full-page redirects that ends back on this site.
 */
export function GithubSignIn({ label = 'Đăng nhập bằng GitHub' }: { label?: string }) {
  const providers = useAuthProviders();
  if (!providers?.github) return null;
  return (
    <>
      <FieldSeparator>hoặc</FieldSeparator>
      <Button variant="outline" className="w-full" asChild>
        <a href={authApi.githubSignInUrl}>
          <GithubMark />
          {label}
        </a>
      </Button>
    </>
  );
}
