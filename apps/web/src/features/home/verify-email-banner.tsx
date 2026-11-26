'use client';

import { MailWarning } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useSignedInUser } from '@/features/auth/auth-provider';
import { ResendVerificationButton } from '@/features/auth/components/resend-verification-button';

/** Reminds a user with an unverified email, on every signed-in page, how to verify it. */
export function VerifyEmailBanner() {
  const user = useSignedInUser();
  if (user.emailVerified) return null;
  return (
    <Alert className="mb-6">
      <MailWarning />
      <AlertTitle>Xác minh email của bạn</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <p>
          Chúng tôi đã gửi link xác minh tới <strong>{user.email}</strong>. Cần xác minh email để
          tạo organization và mời người khác (link dùng được trong 24 giờ).
        </p>
        <ResendVerificationButton />
      </AlertDescription>
    </Alert>
  );
}
