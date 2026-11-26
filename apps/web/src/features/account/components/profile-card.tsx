'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSignedInUser } from '@/features/auth/auth-provider';
import { ResendVerificationButton } from '@/features/auth/components/resend-verification-button';

export function ProfileCard() {
  const user = useSignedInUser();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Thông tin tài khoản</CardTitle>
        <CardDescription>Tên và email dùng để đăng nhập ForgeFlow</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted-foreground">Tên</dt>
          <dd>{user.name ?? '—'}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="flex flex-col items-start gap-3">
            <span className="flex flex-wrap items-center gap-2">
              {user.email}
              {user.emailVerified ? (
                <Badge variant="secondary">Đã xác minh</Badge>
              ) : (
                <Badge variant="destructive">Chưa xác minh</Badge>
              )}
            </span>
            {user.emailVerified ? null : <ResendVerificationButton />}
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}
