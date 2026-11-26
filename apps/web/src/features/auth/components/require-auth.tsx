'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '../auth-provider';
import { loginPathFor } from '../safe-next';

function FullPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * Renders `children` only for a signed-in user. A signed-out visitor is sent to the login page,
 * which brings them back here afterwards.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state, retry } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (state.status === 'signed_out') router.replace(loginPathFor(pathname));
  }, [state.status, router, pathname]);

  if (state.status === 'signed_in') return children;
  if (state.status === 'unavailable') {
    return (
      <FullPage>
        <p>Không kết nối được tới máy chủ ForgeFlow.</p>
        <Button variant="outline" onClick={retry}>
          Thử lại
        </Button>
      </FullPage>
    );
  }
  return (
    <FullPage>
      <Spinner className="size-6" />
    </FullPage>
  );
}
