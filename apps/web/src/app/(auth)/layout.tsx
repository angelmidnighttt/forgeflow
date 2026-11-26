import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';

/** Sign-in, sign-up and emailed-link pages: one card in the middle of the screen. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <Logo />
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
