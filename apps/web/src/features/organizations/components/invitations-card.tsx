'use client';

import {
  createInvitationRequestSchema,
  ErrorCode,
  type Invitation,
  type OrganizationRole,
} from '@forgeflow/contracts';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/features/account/format-time';
import { useAuth, useSignedInUser } from '@/features/auth/auth-provider';
import { FormError, FormSuccess } from '@/features/auth/components/form-alert';
import { SubmitButton } from '@/features/auth/components/submit-button';
import { errorMessage } from '@/features/auth/messages';
import { fieldErrorsFrom, validate, type FieldErrors } from '@/features/auth/validation';
import { ApiError } from '@/lib/api-client';
import { organizationsApi } from '../organizations-api';
import { assignableRoles, ROLE_LABELS } from '../roles';
import { useOrganization } from './organization-scope';
import { RoleSelect } from './role-select';

/** Invite people by email and see / withdraw the invitations not accepted yet. */
export function InvitationsCard() {
  const organization = useOrganization();
  const me = useSignedInUser();
  const { withAccessToken } = useAuth();
  const roles = assignableRoles(organization.role);

  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const [values, setValues] = useState<{ email: string; role: OrganizationRole }>({
    email: '',
    role: roles.includes('member') ? 'member' : (roles[0] ?? 'viewer'),
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      setInvitations(
        await withAccessToken((t) => organizationsApi.invitations(t, organization.id)),
      );
    } catch (error) {
      setListError(errorMessage(error));
    }
  }, [withAccessToken, organization.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validate(createInvitationRequestSchema, values);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setSentTo(null);
    setPending(true);
    try {
      await withAccessToken((t) => organizationsApi.invite(t, organization.id, checked.data));
      setSentTo(checked.data.email);
      setValues({ ...values, email: '' });
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.AlreadyMember) {
        setErrors({ email: 'Người này đã là thành viên.' });
      } else {
        setErrors(fieldErrorsFrom(error));
        setFormError(
          errorMessage(error, {
            [ErrorCode.ServiceUnavailable]:
              'Không gửi được email mời lúc này. Lời mời chưa được tạo; thử lại sau ít phút.',
          }),
        );
      }
    } finally {
      setPending(false);
    }
  }

  async function revoke(invitation: Invitation) {
    setRevoking(invitation.id);
    setListError(null);
    try {
      await withAccessToken((t) =>
        organizationsApi.revokeInvitation(t, organization.id, invitation.id),
      );
      await load();
    } catch (error) {
      setListError(errorMessage(error));
    } finally {
      setRevoking(null);
    }
  }

  const now = Date.now();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mời thành viên</CardTitle>
        <CardDescription>
          Lời mời được gửi qua email, dùng được một lần trong 7 ngày. Người nhận phải đăng nhập bằng
          đúng email được mời.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            {sentTo ? <FormSuccess>Đã gửi lời mời tới {sentTo}.</FormSuccess> : null}
            <FormError
              message={
                me.emailVerified ? formError : 'Hãy xác minh email trước khi mời người khác.'
              }
            />
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <Field data-invalid={Boolean(errors.email)} className="sm:flex-1">
                <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="dong-nghiep@congty.vn"
                  value={values.email}
                  onChange={(e) => setValues({ ...values, email: e.target.value })}
                  aria-invalid={Boolean(errors.email)}
                  disabled={!me.emailVerified}
                />
                <FieldError>{errors.email}</FieldError>
              </Field>
              <Field className="sm:w-56">
                <FieldLabel htmlFor="invite-role">Vai trò</FieldLabel>
                <RoleSelect
                  id="invite-role"
                  value={values.role}
                  roles={roles}
                  onChange={(role) => setValues({ ...values, role })}
                  disabled={!me.emailVerified}
                  describe
                />
              </Field>
            </div>
            <div>
              <SubmitButton pending={pending} disabled={pending || !me.emailVerified}>
                Gửi lời mời
              </SubmitButton>
            </div>
          </FieldGroup>
        </form>

        <Separator />

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Lời mời đang chờ</h3>
          <FormError message={listError} />
          {invitations === null && !listError ? <Spinner className="size-5" /> : null}
          {invitations?.length === 0 ? (
            <p className="text-sm text-muted-foreground">Không có lời mời nào đang chờ.</p>
          ) : null}
          {invitations?.map((invitation) => {
            const expired = Date.parse(invitation.expiresAt) <= now;
            return (
              <div key={invitation.id} className="flex items-center gap-3 text-sm">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {invitation.email}
                    <Badge variant="secondary">{ROLE_LABELS[invitation.role]}</Badge>
                    {expired ? <Badge variant="destructive">Đã hết hạn</Badge> : null}
                  </span>
                  <span className="text-muted-foreground">
                    {invitation.invitedBy
                      ? `Mời bởi ${invitation.invitedBy.name ?? invitation.invitedBy.email} · `
                      : ''}
                    {expired ? 'Hết hạn' : 'Hết hạn lúc'} {formatDateTime(invitation.expiresAt)}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revoking !== null}
                  onClick={() => void revoke(invitation)}
                >
                  {revoking === invitation.id ? <Spinner /> : null}
                  Thu hồi
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
