'use client';

import { loginRequestSchema } from '@forgeflow/contracts';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authApi } from '../auth-api';
import { useAuth } from '../auth-provider';
import { errorMessage, oauthErrorMessage } from '../messages';
import { safeNextPath } from '../safe-next';
import { useRedirectWhenSignedIn } from '../use-redirect-when-signed-in';
import { fieldErrorsFrom, validate, type FieldErrors } from '../validation';
import { FormError } from './form-alert';
import { GithubSignIn } from './github-button';
import { PasswordInput } from './password-input';
import { SubmitButton } from './submit-button';

export function LoginForm() {
  const params = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const { acceptSignIn } = useAuth();
  useRedirectWhenSignedIn(next);

  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  // A failed "Sign in with GitHub" comes back here as ?error=<code>.
  const [formError, setFormError] = useState(() => oauthErrorMessage(params.get('error')));
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validate(loginRequestSchema, values);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      acceptSignIn(await authApi.login(checked.data));
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      setFormError(errorMessage(error));
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Đăng nhập</CardTitle>
        <CardDescription>Chào mừng bạn quay lại ForgeFlow</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <FormError message={formError} />
            <Field data-invalid={Boolean(errors.email)}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="ban@congty.vn"
                value={values.email}
                onChange={(e) => setValues({ ...values, email: e.target.value })}
                aria-invalid={Boolean(errors.email)}
                autoFocus
              />
              <FieldError>{errors.email}</FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.password)}>
              <div className="flex items-center">
                <FieldLabel htmlFor="password">Mật khẩu</FieldLabel>
                <Link
                  href="/forgot-password"
                  className="ml-auto text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Quên mật khẩu?
                </Link>
              </div>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                value={values.password}
                onChange={(e) => setValues({ ...values, password: e.target.value })}
                aria-invalid={Boolean(errors.password)}
              />
              <FieldError>{errors.password}</FieldError>
            </Field>
            <SubmitButton pending={pending} className="w-full">
              Đăng nhập
            </SubmitButton>
            <GithubSignIn />
            <p className="text-center text-sm text-muted-foreground">
              Chưa có tài khoản?{' '}
              <Link
                href={next === '/' ? '/register' : `/register?next=${encodeURIComponent(next)}`}
                className="text-foreground underline underline-offset-4"
              >
                Đăng ký
              </Link>
            </p>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
