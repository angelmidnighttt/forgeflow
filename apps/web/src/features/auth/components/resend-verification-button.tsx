'use client';

import { ErrorCode } from '@forgeflow/contracts';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api-client';
import { authApi } from '../auth-api';
import { useAuth } from '../auth-provider';
import { errorMessage } from '../messages';

/** Emails a new verification link to the signed-in user and says how it went. */
export function ResendVerificationButton({
  variant = 'outline',
}: {
  variant?: 'outline' | 'default';
}) {
  const { withAccessToken, reloadUser } = useAuth();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function resend() {
    setPending(true);
    setResult(null);
    try {
      await withAccessToken((token) => authApi.resendVerification(token));
      setResult({ ok: true, text: 'Đã gửi. Kiểm tra hộp thư của bạn (cả mục spam).' });
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.EmailAlreadyVerified) {
        await reloadUser().catch(() => {});
      }
      setResult({
        ok: false,
        text: errorMessage(error, {
          [ErrorCode.ServiceUnavailable]: 'Không gửi được email lúc này. Thử lại sau ít phút.',
        }),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant={variant} size="sm" onClick={resend} disabled={pending}>
        {pending ? <Spinner /> : null}
        Gửi lại email xác minh
      </Button>
      {result ? (
        <p
          role="status"
          className={result.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}
        >
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
