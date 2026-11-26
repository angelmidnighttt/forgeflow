'use client';

import type { Session } from '@forgeflow/contracts';
import { Laptop } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { authApi } from '@/features/auth/auth-api';
import { useAuth } from '@/features/auth/auth-provider';
import { FormError } from '@/features/auth/components/form-alert';
import { errorMessage } from '@/features/auth/messages';
import { describeUserAgent } from '../describe-user-agent';
import { formatDateTime, formatRelative } from '../format-time';

/**
 * The devices signed in to this account: one entry per login, newest activity first. `version`
 * reloads the list when it changes (after a password change, for example).
 */
export function SessionsCard({ version = 0 }: { version?: number }) {
  const { withAccessToken, signOut } = useAuth();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSessions(await withAccessToken((token) => authApi.sessions(token)));
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [withAccessToken]);

  useEffect(() => {
    void load();
  }, [load, version]);

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await load();
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusy(null);
    }
  }

  const others = sessions?.filter((session) => !session.current) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Thiết bị đang đăng nhập</CardTitle>
        <CardDescription>
          Mỗi lần đăng nhập là một thiết bị. Đăng xuất những thiết bị bạn không nhận ra, rồi đổi mật
          khẩu.
        </CardDescription>
        {others.length > 0 ? (
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                run('others', () => withAccessToken((token) => authApi.revokeOtherSessions(token)))
              }
            >
              {busy === 'others' ? <Spinner /> : null}
              Đăng xuất thiết bị khác
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FormError message={error} />
        {sessions === null && !error ? (
          <div className="flex justify-center py-4">
            <Spinner className="size-5" />
          </div>
        ) : null}
        {sessions?.map((session, index) => (
          <div key={session.id} className="flex flex-col gap-4">
            {index > 0 ? <Separator /> : null}
            <div className="flex items-start gap-3">
              <Laptop className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium" title={session.userAgent ?? undefined}>
                    {describeUserAgent(session.userAgent)}
                  </span>
                  {session.current ? <Badge variant="secondary">Thiết bị này</Badge> : null}
                </div>
                <span className="text-muted-foreground">
                  {session.ipAddress ? `IP ${session.ipAddress} · ` : ''}
                  Hoạt động {formatRelative(session.lastUsedAt)}
                </span>
                <span className="text-muted-foreground">
                  Đăng nhập lúc {formatDateTime(session.signedInAt)}
                </span>
              </div>
              <Button
                variant={session.current ? 'outline' : 'destructive'}
                size="sm"
                disabled={busy !== null}
                onClick={() => {
                  // Signing out this browser leaves the page (RequireAuth goes to /login).
                  if (session.current) {
                    setBusy(session.id);
                    signOut().catch(() => {});
                    return;
                  }
                  void run(session.id, () =>
                    withAccessToken((token) => authApi.revokeSession(token, session.id)),
                  );
                }}
              >
                {busy === session.id ? <Spinner /> : null}
                Đăng xuất
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
