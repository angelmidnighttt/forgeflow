'use client';

import type { AuthProviders } from '@forgeflow/contracts';
import { useEffect, useState } from 'react';
import { GithubMark } from '@/components/github-mark';
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
