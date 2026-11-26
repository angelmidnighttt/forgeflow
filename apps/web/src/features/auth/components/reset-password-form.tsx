'use client';

import { ErrorCode, PASSWORD_MIN_LENGTH, resetPasswordRequestSchema } from '@forgeflow/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api-client';
import { authApi } from '../auth-api';
import { useAuth } from '../auth-provider';
import { errorMessage } from '../messages';
import { useTokenFromHash } from '../use-token-from-hash';
import { confirmMatches, fieldErrorsFrom, validate, type FieldErrors } from '../validation';
import { FormError, FormSuccess } from './form-alert';
import { PasswordInput } from './password-input';
import { SubmitButton } from './submit-button';

function InvalidLink() {
  return (
    <FieldGroup>
      <FormError message="Link đặt lại mật khẩu không hợp lệ, đã được dùng hoặc đã hết hạn (link chỉ dùng được trong 1 giờ)." />
      <Button asChild>
        <Link href="/forgot-password">Yêu cầu link mới</Link>
      </Button>
    </FieldGroup>
  );
}

export function ResetPasswordForm() {
  const token = useTokenFromHash();
  const { forgetSignIn } = useAuth();
  const [values, setValues] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<'done' | 'invalid' | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const checked = validate(resetPasswordRequestSchema, { token, password: values.password });
    const confirmError = confirmMatches(values.password, values.confirm);
    if (!checked.ok || confirmError) {
      setErrors({ ...(checked.ok ? {} : checked.errors), confirm: confirmError });
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      await authApi.resetPassword(checked.data);
      // The API ended every sign-in of the account, this browser's included.
      forgetSignIn();
      setOutcome('done');
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.InvalidToken) {
        setOutcome('invalid');
      } else {
        setErrors(fieldErrorsFrom(error));
        setFormError(errorMessage(error));
      }
    } finally {
      setPending(false);
    }
  }

  let body;
  if (token === undefined) {
    body = (
      <div className="flex justify-center py-6">
        <Spinner className="size-6" />
      </div>
    );
  } else if (token === null || outcome === 'invalid') {
    body = <InvalidLink />;
  } else if (outcome === 'done') {
    body = (
      <FieldGroup>
        <FormSuccess title="Đã đặt mật khẩu mới">
          Tài khoản đã được đăng xuất khỏi mọi thiết bị. Hãy đăng nhập lại bằng mật khẩu mới.
        </FormSuccess>
        <Button asChild>
          <Link href="/login">Đăng nhập</Link>
        </Button>
      </FieldGroup>
    );
  } else {
    body = (
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <FormError message={formError} />
          <Field data-invalid={Boolean(errors.password)}>
            <FieldLabel htmlFor="password">Mật khẩu mới</FieldLabel>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={values.password}
              onChange={(e) => setValues({ ...values, password: e.target.value })}
              aria-invalid={Boolean(errors.password)}
              autoFocus
            />
            {errors.password ? (
              <FieldError>{errors.password}</FieldError>
            ) : (
              <FieldDescription>Ít nhất {PASSWORD_MIN_LENGTH} ký tự.</FieldDescription>
            )}
          </Field>
          <Field data-invalid={Boolean(errors.confirm)}>
            <FieldLabel htmlFor="confirm">Nhập lại mật khẩu mới</FieldLabel>
            <PasswordInput
              id="confirm"
              autoComplete="new-password"
              value={values.confirm}
              onChange={(e) => setValues({ ...values, confirm: e.target.value })}
              aria-invalid={Boolean(errors.confirm)}
            />
            <FieldError>{errors.confirm}</FieldError>
          </Field>
          <SubmitButton pending={pending} className="w-full">
            Đặt mật khẩu mới
          </SubmitButton>
        </FieldGroup>
      </form>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Đặt lại mật khẩu</CardTitle>
        <CardDescription>Chọn mật khẩu mới cho tài khoản ForgeFlow của bạn</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
