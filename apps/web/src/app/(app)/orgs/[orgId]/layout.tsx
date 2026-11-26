import type { ReactNode } from 'react';
import { OrganizationScope } from '@/features/organizations/components/organization-scope';

/** Every /orgs/[orgId] page: renders only for a member of that organization. */
export default function OrganizationLayout({ children }: { children: ReactNode }) {
  return <OrganizationScope>{children}</OrganizationScope>;
}
