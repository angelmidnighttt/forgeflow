'use client';

import { createOrganizationRequestSchema } from '@forgeflow/contracts';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useAuth, useSignedInUser } from '@/features/auth/auth-provider';
import { FormError } from '@/features/auth/components/form-alert';
import { SubmitButton } from '@/features/auth/components/submit-button';
import { errorMessage } from '@/features/auth/messages';
import { fieldErrorsFrom, validate, type FieldErrors } from '@/features/auth/validation';
import { organizationsApi } from '../organizations-api';
import { useOrganizations } from '../organizations-provider';

/** Creates an organization (the user becomes its owner) and opens it. */
export function CreateOrganizationForm() {
  const user = useSignedInUser();
  const { withAccessToken } = useAuth();
  const { reload } = useOrganizations();
  const router = useRouter();
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validate(createOrganizationRequestSchema, { name });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      const organization = await withAccessToken((token) =>
        organizationsApi.create(token, checked.data.name),
      );
      await reload();
      router.push(`/orgs/${organization.id}`);
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      setFormError(errorMessage(error));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-md">
      <FieldGroup>
        <FormError
          message={
            user.emailVerified
              ? formError
              : 'Hãy xác minh email trước khi tạo organization (mở link trong hộp thư của bạn).'
          }
        />
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor="org-name">Tên organization</FieldLabel>
          <Input
            id="org-name"
            placeholder="Công ty của bạn"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(errors.name)}
            disabled={!user.emailVerified}
            autoFocus
          />
          {errors.name ? (
            <FieldError>{errors.name}</FieldError>
          ) : (
            <FieldDescription>Thường là tên công ty hoặc nhóm. Đổi được sau.</FieldDescription>
          )}
        </Field>
        <div>
          <SubmitButton pending={pending} disabled={pending || !user.emailVerified}>
            Tạo organization
          </SubmitButton>
        </div>
      </FieldGroup>
    </form>
  );
}
