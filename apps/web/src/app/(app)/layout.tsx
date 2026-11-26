import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { RequireAuth } from '@/features/auth/components/require-auth';

/** Pages for signed-in users: a signed-out visitor is sent to /login and back. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl px-6 py-8">{children}</main>
    </RequireAuth>
  );
}
