'use client';

import { changePasswordRequestSchema, ErrorCode, PASSWORD_MIN_LENGTH } from '@forgeflow/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { ApiError } from '@/lib/api-client';
import { authApi } from '@/features/auth/auth-api';
import { useAuth } from '@/features/auth/auth-provider';
import { FormError, FormSuccess } from '@/features/auth/components/form-alert';
import { PasswordInput } from '@/features/auth/components/password-input';
import { SubmitButton } from '@/features/auth/components/submit-button';
import { errorMessage } from '@/features/auth/messages';
import {
  confirmMatches,
  fieldErrorsFrom,
  validate,
  type FieldErrors,
} from '@/features/auth/validation';

const EMPTY = { currentPassword: '', newPassword: '', confirm: '' };

/**
 * Changing the password signs out every other device; this one gets a fresh sign-in, which
 * `onChanged` hears about so the list of devices can reload.
 */
export function ChangePasswordCard({ onChanged }: { onChanged?: () => void }) {
  const { withAccessToken, acceptSignIn } = useAuth();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [noPassword, setNoPassword] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validate(changePasswordRequestSchema, {
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });
    const confirmError = confirmMatches(values.newPassword, values.confirm);
    if (!checked.ok || confirmError) {
      setErrors({ ...(checked.ok ? {} : checked.errors), confirm: confirmError });
      return;
    }
    setErrors({});
    setFormError(null);
    setDone(false);
    setPending(true);
    try {
      const tokens = await withAccessToken((token) => authApi.changePassword(token, checked.data));
      acceptSignIn(tokens);
      setValues(EMPTY);
      setDone(true);
      onChanged?.();
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.InvalidPassword) {
        setErrors({ currentPassword: 'Mật khẩu hiện tại không đúng.' });
      } else if (error instanceof ApiError && error.code === ErrorCode.PasswordNotSet) {
        setNoPassword(true);
      } else {
        setErrors(fieldErrorsFrom(error));
        setFormError(errorMessage(error));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Đổi mật khẩu</CardTitle>
        <CardDescription>
          Sau khi đổi, các thiết bị khác sẽ bị đăng xuất; thiết bị này vẫn đăng nhập.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {noPassword ? (
          <FormError message='Tài khoản chưa có mật khẩu vì bạn đăng nhập bằng GitHub. Hãy dùng "Quên mật khẩu" để đặt mật khẩu.' />
        ) : (
          <form onSubmit={onSubmit} noValidate className="max-w-md">
            <FieldGroup>
              {done ? (
                <FormSuccess>Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.</FormSuccess>
              ) : null}
              <FormError message={formError} />
              <Field data-invalid={Boolean(errors.currentPassword)}>
                <div className="flex items-center">
                  <FieldLabel htmlFor="current-password">Mật khẩu hiện tại</FieldLabel>
                  <Link
                    href="/forgot-password"
                    className="ml-auto text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Quên mật khẩu?
                  </Link>
                </div>
                <PasswordInput
                  id="current-password"
                  autoComplete="current-password"
                  value={values.currentPassword}
                  onChange={(e) => setValues({ ...values, currentPassword: e.target.value })}
                  aria-invalid={Boolean(errors.currentPassword)}
                />
                <FieldError>{errors.currentPassword}</FieldError>
              </Field>
              <Field data-invalid={Boolean(errors.newPassword)}>
                <FieldLabel htmlFor="new-password">Mật khẩu mới</FieldLabel>
                <PasswordInput
                  id="new-password"
                  autoComplete="new-password"
                  value={values.newPassword}
                  onChange={(e) => setValues({ ...values, newPassword: e.target.value })}
                  aria-invalid={Boolean(errors.newPassword)}
                />
                {errors.newPassword ? (
                  <FieldError>{errors.newPassword}</FieldError>
                ) : (
                  <FieldDescription>Ít nhất {PASSWORD_MIN_LENGTH} ký tự.</FieldDescription>
                )}
              </Field>
              <Field data-invalid={Boolean(errors.confirm)}>
                <FieldLabel htmlFor="confirm-password">Nhập lại mật khẩu mới</FieldLabel>
                <PasswordInput
                  id="confirm-password"
                  autoComplete="new-password"
                  value={values.confirm}
                  onChange={(e) => setValues({ ...values, confirm: e.target.value })}
                  aria-invalid={Boolean(errors.confirm)}
                />
                <FieldError>{errors.confirm}</FieldError>
              </Field>
              <div>
                <SubmitButton pending={pending}>Đổi mật khẩu</SubmitButton>
              </div>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
