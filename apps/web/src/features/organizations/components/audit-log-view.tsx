'use client';

import { can, type AuditLogEntry } from '@forgeflow/contracts';
import { useCallback, useEffect, useState } from 'react';
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
import { formatDateTime, formatRelative } from '@/features/account/format-time';
import { useAuth } from '@/features/auth/auth-provider';
import { FormError } from '@/features/auth/components/form-alert';
import { errorMessage } from '@/features/auth/messages';
import { auditActorName, describeAuditEntry } from '../audit-format';
import { organizationsApi } from '../organizations-api';
import { useOrganization } from './organization-scope';

/** The organization's audit trail, newest first, a page at a time. Owners and admins only. */
export function AuditLogView() {
  const organization = useOrganization();
  const allowed = can(organization.role, 'audit.read');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nhật ký hoạt động</h1>
        <p className="text-sm text-muted-foreground">
          Các thao tác quan trọng trong {organization.name}: ai làm, làm gì, lúc nào, từ đâu.
        </p>
      </div>
      {allowed ? (
        <AuditLogCard />
      ) : (
        <p className="text-sm text-muted-foreground">
          Chỉ chủ sở hữu và quản trị viên xem được nhật ký hoạt động.
        </p>
      )}
    </div>
  );
}

function AuditLogCard() {
  const organization = useOrganization();
  const { withAccessToken } = useAuth();
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      setError(null);
      try {
        const page = await withAccessToken((t) =>
          organizationsApi.auditLog(t, organization.id, cursor),
        );
        setEntries((previous) => (cursor ? [...(previous ?? []), ...page.entries] : page.entries));
        setNextCursor(page.nextCursor);
      } catch (loadError) {
        setError(errorMessage(loadError));
      }
    },
    [withAccessToken, organization.id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    await load(nextCursor);
    setLoadingMore(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hoạt động gần đây</CardTitle>
        <CardDescription>
          Mỗi mục được ghi cùng lúc với thao tác của nó và không sửa, không xoá được.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FormError message={error} />
        {entries === null && !error ? (
          <div className="flex justify-center py-4">
            <Spinner className="size-5" />
          </div>
        ) : null}
        {entries?.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Chưa có hoạt động nào.</p>
        ) : null}
        {entries && entries.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Thời gian</TableHead>
                <TableHead>Người thực hiện</TableHead>
                <TableHead>Hoạt động</TableHead>
                <TableHead className="hidden md:table-cell">Địa chỉ IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="align-top text-muted-foreground">
                    <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>
                      {formatRelative(entry.createdAt)}
                    </time>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="font-medium">{auditActorName(entry.actor)}</div>
                    {entry.actor.name && entry.actor.email ? (
                      <div className="text-xs text-muted-foreground">{entry.actor.email}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    {describeAuditEntry(entry)}
                  </TableCell>
                  <TableCell className="hidden align-top font-mono text-xs text-muted-foreground md:table-cell">
                    {entry.ipAddress ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        {nextCursor ? (
          <div className="flex justify-center">
            <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? <Spinner /> : null}
              Xem thêm
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
