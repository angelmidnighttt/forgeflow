'use client';

import { ErrorCode, type InvitationPreview } from '@forgeflow/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/features/account/format-time';
import { useAuth } from '@/features/auth/auth-provider';
import { FormError } from '@/features/auth/components/form-alert';
import { errorMessage } from '@/features/auth/messages';
import { useTokenFromHash } from '@/features/auth/use-token-from-hash';
import { ApiError } from '@/lib/api-client';
import { organizationsApi } from '../organizations-api';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../roles';

const STORAGE_KEY = 'forgeflow:invitation-token';
const HERE = '/invitations/accept';

/**
 * The invitation token: from the link's fragment on arrival, then kept for this tab in
 * sessionStorage, so it survives a detour through login or sign-up back to this page.
 */
function useInvitationToken(): string | null | undefined {
  const fromLink = useTokenFromHash();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (fromLink === undefined) return;
    if (fromLink) {
      window.sessionStorage.setItem(STORAGE_KEY, fromLink);
      setToken(fromLink);
    } else {
      setToken(window.sessionStorage.getItem(STORAGE_KEY));
    }
  }, [fromLink]);
  return token;
}

const INVALID =
  'Lời mời không hợp lệ: link đã được dùng, đã bị thu hồi hoặc đã hết hạn (link dùng được trong 7 ngày). Hãy nhờ người mời gửi lại.';

export function AcceptInvitationView() {
  const token = useInvitationToken();
  const { state, withAccessToken, signOut } = useAuth();
  const router = useRouter();
  const [preview, setPreview] = useState<InvitationPreview | 'invalid' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (token === undefined) return;
    if (token === null) {
      setPreview('invalid');
      return;
    }
    organizationsApi.lookupInvitation(token).then(setPreview, (lookupError: unknown) => {
      if (lookupError instanceof ApiError && lookupError.code === ErrorCode.InvalidToken) {
        setPreview('invalid');
      } else {
        setError(errorMessage(lookupError));
      }
    });
  }, [token]);

  async function accept() {
    if (!token) return;
    setPending(true);
    setError(null);
    try {
      const organization = await withAccessToken((t) =>
        organizationsApi.acceptInvitation(t, token),
      );
      window.sessionStorage.removeItem(STORAGE_KEY);
      router.push(`/orgs/${organization.id}`);
    } catch (acceptError) {
      if (acceptError instanceof ApiError && acceptError.code === ErrorCode.InvalidToken) {
        setPreview('invalid');
      } else {
        setError(errorMessage(acceptError));
      }
      setPending(false);
    }
  }

  let body;
  if (preview === 'invalid') {
    body = (
      <FieldGroup>
        <FormError message={INVALID} />
        <Button variant="outline" asChild>
          <Link href="/">Về trang chủ</Link>
        </Button>
      </FieldGroup>
    );
  } else if (!preview) {
    body = error ? (
      <FormError message={error} />
    ) : (
      <div className="flex justify-center py-6">
        <Spinner className="size-6" />
      </div>
    );
  } else {
    const inviter = preview.invitedBy?.name ?? 'Một thành viên';
    const signedInEmail = state.status === 'signed_in' ? state.user.email : null;
    const matches = signedInEmail?.toLowerCase() === preview.email;
    const loginHref = `/login?next=${encodeURIComponent(HERE)}`;
    const registerHref = `/register?next=${encodeURIComponent(HERE)}&email=${encodeURIComponent(preview.email)}`;

    body = (
      <FieldGroup>
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <strong>{inviter}</strong> mời bạn tham gia <strong>{preview.organization.name}</strong>{' '}
            với vai trò <strong>{ROLE_LABELS[preview.role]}</strong>.
          </p>
          <p className="text-muted-foreground">{ROLE_DESCRIPTIONS[preview.role]}</p>
          <p className="text-muted-foreground">
            Lời mời gửi tới {preview.email} · hết hạn lúc {formatDateTime(preview.expiresAt)}
          </p>
        </div>
        <FormError message={error} />
        {state.status === 'loading' ? (
          <div className="flex justify-center">
            <Spinner />
          </div>
        ) : null}
        {state.status === 'signed_out' || state.status === 'unavailable' ? (
          <>
            <p className="text-sm">
              Đăng nhập hoặc tạo tài khoản bằng <strong>{preview.email}</strong> để nhận lời mời.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="sm:flex-1">
                <Link href={loginHref}>Đăng nhập</Link>
              </Button>
              <Button variant="outline" asChild className="sm:flex-1">
                <Link href={registerHref}>Tạo tài khoản</Link>
              </Button>
            </div>
          </>
        ) : null}
        {state.status === 'signed_in' && matches ? (
          <Button onClick={() => void accept()} disabled={pending}>
            {pending ? <Spinner /> : null}
            Tham gia {preview.organization.name}
          </Button>
        ) : null}
        {state.status === 'signed_in' && !matches ? (
          <>
            <FormError
              message={`Lời mời gửi tới ${preview.email}, nhưng bạn đang đăng nhập bằng ${signedInEmail}. Hãy đăng xuất rồi đăng nhập bằng đúng email được mời.`}
            />
            <Button variant="outline" onClick={() => void signOut().catch(() => {})}>
              Đăng xuất để dùng email khác
            </Button>
          </>
        ) : null}
      </FieldGroup>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Lời mời tham gia</CardTitle>
        <CardDescription>Tham gia một organization trên ForgeFlow</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
