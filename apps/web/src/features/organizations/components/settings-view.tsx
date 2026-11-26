'use client';

import { can, updateOrganizationRequestSchema } from '@forgeflow/contracts';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useAuth, useSignedInUser } from '@/features/auth/auth-provider';
import { FormError, FormSuccess } from '@/features/auth/components/form-alert';
import { SubmitButton } from '@/features/auth/components/submit-button';
import { errorMessage } from '@/features/auth/messages';
import { fieldErrorsFrom, validate, type FieldErrors } from '@/features/auth/validation';
import { organizationsApi } from '../organizations-api';
import { useOrganizations } from '../organizations-provider';
import { ROLE_LABELS } from '../roles';
import { useOrganization } from './organization-scope';

function RenameCard() {
  const organization = useOrganization();
  const { withAccessToken } = useAuth();
  const { reload } = useOrganizations();
  const [name, setName] = useState(organization.name);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const editable = can(organization.role, 'organization.update');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validate(updateOrganizationRequestSchema, { name });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setSaved(false);
    setPending(true);
    try {
      await withAccessToken((t) => organizationsApi.rename(t, organization.id, checked.data.name));
      await reload();
      setSaved(true);
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Thông tin organization</CardTitle>
        <CardDescription>
          {editable
            ? 'Tên hiển thị cho mọi thành viên.'
            : `Chỉ chủ sở hữu và quản trị viên đổi được tên. Vai trò của bạn: ${ROLE_LABELS[organization.role]}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="max-w-md">
          <FieldGroup>
            {saved ? <FormSuccess>Đã lưu tên mới.</FormSuccess> : null}
            <FormError message={formError} />
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor="org-name">Tên</FieldLabel>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={Boolean(errors.name)}
                disabled={!editable}
              />
              <FieldError>{errors.name}</FieldError>
            </Field>
            {editable ? (
              <div>
                <SubmitButton pending={pending}>Lưu</SubmitButton>
              </div>
            ) : null}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

function LeaveCard() {
  const organization = useOrganization();
  const me = useSignedInUser();
  const { withAccessToken } = useAuth();
  const { reload } = useOrganizations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function leave() {
    setPending(true);
    setError(null);
    try {
      await withAccessToken((t) => organizationsApi.removeMember(t, organization.id, me.id));
      await reload();
      router.replace('/');
    } catch (leaveError) {
      setError(errorMessage(leaveError));
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rời organization</CardTitle>
        <CardDescription>
          Bạn sẽ mất quyền truy cập {organization.name} cho tới khi được mời lại.
          {organization.role === 'owner'
            ? ' Nếu bạn là chủ sở hữu duy nhất, hãy cho người khác làm chủ sở hữu trước.'
            : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4">
        <FormError message={error} />
        <ConfirmDialog
          trigger={
            <Button variant="destructive" disabled={pending}>
              {pending ? <Spinner /> : null}
              Rời organization
            </Button>
          }
          title={`Rời ${organization.name}?`}
          description="Bạn sẽ mất quyền truy cập ngay lập tức."
          confirmLabel="Rời organization"
          onConfirm={() => void leave()}
        />
      </CardContent>
    </Card>
  );
}

export function SettingsView() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Cài đặt</h1>
      <RenameCard />
      <LeaveCard />
    </div>
  );
}
