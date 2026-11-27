'use client';

import { can } from '@forgeflow/contracts';
import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAuth, useSignedInUser } from '@/features/auth/auth-provider';
import { OrgSwitcher } from '@/features/organizations/components/org-switcher';
import { useRouteOrganization } from '@/features/organizations/organizations-provider';
import { cn } from '@/lib/utils';
import { Logo } from './logo';

/** Top bar of the signed-in pages: organization, its sections, the account and sign-out. */
export function AppHeader() {
  const user = useSignedInUser();
  const { signOut } = useAuth();
  const pathname = usePathname();
  const organization = useRouteOrganization();
  const [leaving, setLeaving] = useState(false);

  const nav = [
    ...(organization
      ? [
          { href: `/orgs/${organization.id}`, label: 'Tổng quan' },
          { href: `/orgs/${organization.id}/members`, label: 'Thành viên' },
          ...(can(organization.role, 'audit.read')
            ? [{ href: `/orgs/${organization.id}/audit`, label: 'Nhật ký' }]
            : []),
          { href: `/orgs/${organization.id}/settings`, label: 'Cài đặt' },
        ]
      : []),
    { href: '/account', label: 'Tài khoản' },
  ];

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-6">
        <Logo />
        <span className="text-muted-foreground">/</span>
        <OrgSwitcher />
        <nav className="ml-4 hidden items-center gap-1 text-sm md:flex">
          {nav.map((item) => (
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
          <span className="hidden text-sm text-muted-foreground lg:inline">{user.email}</span>
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
      {/* Small screens: the sections go on a second row. */}
      <nav className="mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto px-4 pb-2 text-sm md:hidden">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'shrink-0 rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted',
              pathname === item.href && 'bg-muted font-medium text-foreground',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
