'use client';

import { ErrorCode } from '@forgeflow/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api-client';
import { authApi } from '../auth-api';
import { useAuth } from '../auth-provider';
import { errorMessage } from '../messages';
import { useTokenFromHash } from '../use-token-from-hash';
import { FormError, FormSuccess } from './form-alert';
import { ResendVerificationButton } from './resend-verification-button';

type Outcome =
  | { status: 'verifying' }
  | { status: 'verified' }
  | { status: 'invalid' }
  | { status: 'error'; message: string };

/**
 * Opened from the verification email: sends the token from the link to the API right away.
 * Works whether or not this browser is signed in; the token alone proves the inbox.
 */
export function VerifyEmailView() {
  const token = useTokenFromHash();
  const { state, reloadUser } = useAuth();
  const [outcome, setOutcome] = useState<Outcome>({ status: 'verifying' });
  // Strict Mode runs effects twice in development; a token works only once.
  const sent = useRef(false);

  useEffect(() => {
    if (token === undefined || sent.current) return;
    sent.current = true;
    if (token === null) {
      setOutcome({ status: 'invalid' });
      return;
    }
    authApi.verifyEmail(token).then(
      () => setOutcome({ status: 'verified' }),
      (error: unknown) =>
        setOutcome(
          error instanceof ApiError && error.code === ErrorCode.InvalidToken
            ? { status: 'invalid' }
            : { status: 'error', message: errorMessage(error) },
        ),
    );
  }, [token]);

  // The sign-in check may finish before or after the verification: refresh the user either way.
  const signedInUnverified = state.status === 'signed_in' && !state.user.emailVerified;
  useEffect(() => {
    if (outcome.status === 'verified' && signedInUnverified) reloadUser().catch(() => {});
  }, [outcome.status, signedInUnverified, reloadUser]);

  const signedIn = state.status === 'signed_in';
  let body;
  switch (outcome.status) {
    case 'verifying':
      body = (
        <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted-foreground">
          <Spinner className="size-6" />
          Đang xác minh email…
        </div>
      );
      break;
    case 'verified':
      body = (
        <FieldGroup>
          <FormSuccess title="Email đã được xác minh">
            Cảm ơn bạn. Tài khoản ForgeFlow của bạn đã sẵn sàng.
          </FormSuccess>
          <Button asChild>
            <Link href={signedIn ? '/' : '/login'}>{signedIn ? 'Vào ForgeFlow' : 'Đăng nhập'}</Link>
          </Button>
        </FieldGroup>
      );
      break;
    case 'invalid':
      body = (
        <FieldGroup>
          <FormError message="Link xác minh không hợp lệ, đã được dùng hoặc đã hết hạn (link dùng được trong 24 giờ). Chỉ link trong email gần nhất còn hiệu lực." />
          {signedIn ? (
            <ResendVerificationButton variant="default" />
          ) : (
            <Button asChild>
              <Link href="/login?next=%2Faccount">Đăng nhập để gửi lại email</Link>
            </Button>
          )}
        </FieldGroup>
      );
      break;
    case 'error':
      body = <FormError message={outcome.message} />;
      break;
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Xác minh email</CardTitle>
        <CardDescription>Xác nhận địa chỉ email của tài khoản ForgeFlow</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
