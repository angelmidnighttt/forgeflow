'use client';

import { can } from '@forgeflow/contracts';
import { InvitationsCard } from './invitations-card';
import { MembersCard } from './members-card';
import { useOrganization } from './organization-scope';

export function MembersView() {
  const organization = useOrganization();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Thành viên</h1>
        <p className="text-sm text-muted-foreground">
          Ai làm việc trong {organization.name}, với vai trò gì.
        </p>
      </div>
      {can(organization.role, 'invitations.manage') ? <InvitationsCard /> : null}
      <MembersCard />
    </div>
  );
}
