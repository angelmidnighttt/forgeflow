'use client';

import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useOrganizations, useRouteOrganization } from '../organizations-provider';
import { ROLE_LABELS } from '../roles';

/** Shows the current organization and switches to another one, or to creating one. */
export function OrgSwitcher() {
  const { state } = useOrganizations();
  const current = useRouteOrganization();
  const organizations = state.status === 'ready' ? state.organizations : [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-56 gap-2">
          <span className="truncate">{current?.name ?? 'Chọn organization'}</span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Organization của bạn</DropdownMenuLabel>
        {organizations.length === 0 ? (
          <DropdownMenuItem disabled>Chưa có organization nào</DropdownMenuItem>
        ) : null}
        {organizations.map((organization) => (
          <DropdownMenuItem key={organization.id} asChild>
            <Link href={`/orgs/${organization.id}`} className="flex items-center gap-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{organization.name}</span>
                <span className="text-xs text-muted-foreground">
                  {ROLE_LABELS[organization.role]}
                </span>
              </span>
              {organization.id === current?.id ? <Check /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/orgs/new">
            <Plus />
            Tạo organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
