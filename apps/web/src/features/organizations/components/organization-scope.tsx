'use client';

import type { Organization } from '@forgeflow/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { FormError } from '@/features/auth/components/form-alert';
import { rememberLastOrganization } from '../last-organization';
import { useOrganizations } from '../organizations-provider';

const OrganizationContext = createContext<Organization | null>(null);

/**
 * Wraps the /orgs/[orgId] pages: finds the organization among the user's own, so a page only
 * renders for a member, and remembers it as the last one opened. The API checks again on
 * every call; this only decides what to show.
 */
export function OrganizationScope({ children }: { children: ReactNode }) {
  const { orgId } = useParams<{ orgId: string }>();
  const { state } = useOrganizations();
  const organization =
    state.status === 'ready' ? state.organizations.find((o) => o.id === orgId) : undefined;

  useEffect(() => {
    if (organization) rememberLastOrganization(organization.id);
  }, [organization]);

  if (state.status === 'loading') {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (state.status === 'error') return <FormError message={state.message} />;
  if (!organization) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <h1 className="text-xl font-semibold">Không tìm thấy organization</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Organization này không tồn tại, hoặc bạn không phải thành viên của nó.
        </p>
        <Button asChild>
          <Link href="/">Về trang chủ</Link>
        </Button>
      </div>
    );
  }
  // Keyed by id: switching organization on the same page starts its forms and lists afresh.
  return (
    <OrganizationContext.Provider key={organization.id} value={organization}>
      {children}
    </OrganizationContext.Provider>
  );
}

/** The organization of the page, with the caller's role in it. Inside <OrganizationScope>. */
export function useOrganization(): Organization {
  const organization = useContext(OrganizationContext);
  if (!organization) throw new Error('useOrganization must be used inside <OrganizationScope>');
  return organization;
}
