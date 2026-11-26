'use client';

import { canManageMember, type Member, type OrganizationRole } from '@forgeflow/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/features/account/format-time';
import { useAuth, useSignedInUser } from '@/features/auth/auth-provider';
import { FormError } from '@/features/auth/components/form-alert';
import { errorMessage } from '@/features/auth/messages';
import { organizationsApi } from '../organizations-api';
import { useOrganizations } from '../organizations-provider';
import { assignableRoles, ROLE_LABELS } from '../roles';
import { useOrganization } from './organization-scope';
import { RoleSelect } from './role-select';

/**
 * Members of the organization. Role changes and removals are offered only where the API will
 * allow them (canManageMember / canAssignRole); the API still checks every request.
 */
export function MembersCard() {
  const organization = useOrganization();
  const me = useSignedInUser();
  const { withAccessToken } = useAuth();
  const { reload: reloadOrganizations } = useOrganizations();
  const router = useRouter();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMembers(await withAccessToken((t) => organizationsApi.members(t, organization.id)));
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [withAccessToken, organization.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(userId: string, action: () => Promise<unknown>, after?: () => Promise<void>) {
    setBusy(userId);
    setError(null);
    try {
      await action();
      await (after ? after() : load());
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusy(null);
    }
  }

  const changeRole = (member: Member, role: OrganizationRole) =>
    run(
      member.userId,
      () =>
        withAccessToken((t) =>
          organizationsApi.changeRole(t, organization.id, member.userId, role),
        ),
      // Changing your own role (an owner stepping down) changes what you may do here.
      member.userId === me.id
        ? async () => {
            await reloadOrganizations();
            await load();
          }
        : undefined,
    );

  const remove = (member: Member) =>
    run(
      member.userId,
      () =>
        withAccessToken((t) => organizationsApi.removeMember(t, organization.id, member.userId)),
      member.userId === me.id
        ? async () => {
            await reloadOrganizations();
            router.replace('/');
          }
        : undefined,
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Thành viên{members ? ` (${members.length})` : ''}</CardTitle>
        <CardDescription>Những người có quyền truy cập {organization.name}.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FormError message={error} />
        {members === null && !error ? (
          <div className="flex justify-center py-4">
            <Spinner className="size-5" />
          </div>
        ) : null}
        {members ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Người dùng</TableHead>
                <TableHead>Vai trò</TableHead>
                <TableHead className="hidden sm:table-cell">Tham gia</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Thao tác</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const isMe = member.userId === me.id;
                const manageable = canManageMember(organization.role, member.role);
                // The member's current role stays in the list even when it cannot be given.
                const roles = assignableRoles(organization.role);
                const options = roles.includes(member.role) ? roles : [member.role, ...roles];
                return (
                  <TableRow key={member.userId}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="flex items-center gap-2 font-medium">
                          {member.name ?? member.email}
                          {isMe ? <Badge variant="outline">Bạn</Badge> : null}
                        </span>
                        <span className="text-xs text-muted-foreground">{member.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {manageable ? (
                        <RoleSelect
                          value={member.role}
                          roles={options}
                          onChange={(role) => {
                            if (role !== member.role) void changeRole(member, role);
                          }}
                          disabled={busy !== null}
                          aria-label={`Vai trò của ${member.name ?? member.email}`}
                        />
                      ) : (
                        <Badge variant="secondary">{ROLE_LABELS[member.role]}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {formatDateTime(member.joinedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {busy === member.userId ? <Spinner className="ml-auto" /> : null}
                      {busy !== member.userId && (isMe || manageable) ? (
                        <ConfirmDialog
                          trigger={
                            <Button variant="ghost" size="sm" disabled={busy !== null}>
                              {isMe ? 'Rời' : 'Xoá'}
                            </Button>
                          }
                          title={isMe ? `Rời ${organization.name}?` : 'Xoá thành viên?'}
                          description={
                            isMe
                              ? 'Bạn sẽ mất quyền truy cập organization này cho tới khi được mời lại.'
                              : `${member.name ?? member.email} sẽ mất quyền truy cập ${organization.name} ngay lập tức.`
                          }
                          confirmLabel={isMe ? 'Rời organization' : 'Xoá'}
                          onConfirm={() => void remove(member)}
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
