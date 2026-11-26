'use client';

import { MailWarning } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSignedInUser } from '@/features/auth/auth-provider';
import { ResendVerificationButton } from '@/features/auth/components/resend-verification-button';
import { SystemStatus } from '@/features/system-status/system-status';

export function HomeView() {
  const user = useSignedInUser();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Xin chào{user.name ? `, ${user.name}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">Đây là trang tổng quan ForgeFlow của bạn.</p>
      </div>

      {user.emailVerified ? null : (
        <Alert>
          <MailWarning />
          <AlertTitle>Xác minh email của bạn</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>
              Chúng tôi đã gửi link xác minh tới <strong>{user.email}</strong>. Mở email và bấm vào
              link để xác nhận đây là email của bạn (link dùng được trong 24 giờ).
            </p>
            <ResendVerificationButton />
          </AlertDescription>
        </Alert>
      )}

      <SystemStatus />

      <Card>
        <CardHeader>
          <CardTitle>Sắp có</CardTitle>
          <CardDescription>Các phần tiếp theo của ForgeFlow</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Tổ chức và thành viên, dự án và môi trường, deployment, cảnh báo và sự cố sẽ xuất hiện ở
          đây trong các bản phát hành tới.
        </CardContent>
      </Card>
    </div>
  );
}
