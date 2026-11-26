'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { formatUptime, loadSystemStatus, type SystemStatusSnapshot } from './load-system-status';

const REFRESH_MS = 10_000;

function Status({ ok, children }: { ok: boolean; children: string }) {
  return <Badge variant={ok ? 'secondary' : 'destructive'}>{children}</Badge>;
}

/** Health of this ForgeFlow deployment, refreshed every 10 seconds. */
export function SystemStatus() {
  const [snapshot, setSnapshot] = useState<SystemStatusSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      loadSystemStatus().then((next) => {
        if (active) setSnapshot(next);
      });
    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const apiUp = snapshot?.health != null;
  const databaseUp = snapshot?.readiness?.checks.database === 'up';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trạng thái hệ thống</CardTitle>
        <CardDescription>
          {snapshot
            ? `Kiểm tra lúc ${snapshot.checkedAt.toLocaleTimeString('vi-VN')} · tự làm mới mỗi ${REFRESH_MS / 1000} giây`
            : 'Đang kiểm tra…'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {snapshot ? (
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4" aria-live="polite">
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">API</dt>
              <dd>
                <Status ok={apiUp}>{apiUp ? 'Hoạt động' : 'Không phản hồi'}</Status>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Cơ sở dữ liệu</dt>
              <dd>
                {snapshot.readiness ? (
                  <Status ok={databaseUp}>{databaseUp ? 'Đã kết nối' : 'Mất kết nối'}</Status>
                ) : (
                  <Badge variant="outline">Không rõ</Badge>
                )}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Phiên bản</dt>
              <dd className="font-mono">{snapshot.health?.version ?? '—'}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Thời gian chạy</dt>
              <dd className="font-mono">
                {snapshot.health ? formatUptime(snapshot.health.uptimeSeconds) : '—'}
              </dd>
            </div>
          </dl>
        ) : (
          <Spinner className="size-5" />
        )}
      </CardContent>
    </Card>
  );
}
