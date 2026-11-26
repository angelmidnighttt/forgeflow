'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAuth, useSignedInUser } from '@/features/auth/auth-provider';
import { cn } from '@/lib/utils';
import { Logo } from './logo';

const NAV = [
  { href: '/', label: 'Tổng quan' },
  { href: '/account', label: 'Tài khoản' },
];

/** Top bar of the signed-in pages: navigation, who is signed in, and sign-out. */
export function AppHeader() {
  const user = useSignedInUser();
  const { signOut } = useAuth();
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-6 px-6">
        <Logo />
        <nav className="flex items-center gap-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground',
                pathname === item.href && 'bg-muted font-medium text-foreground',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={leaving}
            onClick={() => {
              setLeaving(true);
              signOut().catch(() => setLeaving(false));
            }}
          >
            {leaving ? <Spinner /> : <LogOut />}
            Đăng xuất
          </Button>
        </div>
      </div>
    </header>
  );
}
