'use client';

import { ErrorCode, PASSWORD_MIN_LENGTH, registerRequestSchema } from '@forgeflow/contracts';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { authApi } from '../auth-api';
import { useAuth } from '../auth-provider';
import { errorMessage } from '../messages';
import { safeNextPath } from '../safe-next';
import { useRedirectWhenSignedIn } from '../use-redirect-when-signed-in';
import { fieldErrorsFrom, validate, type FieldErrors } from '../validation';
import { FormError } from './form-alert';
import { GithubSignIn } from './github-button';
import { PasswordInput } from './password-input';
import { SubmitButton } from './submit-button';

export function RegisterForm() {
  const params = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const { acceptSignIn } = useAuth();
  useRedirectWhenSignedIn(next);

  // An invitation link sends invitees here with the invited address filled in.
  const [values, setValues] = useState({
    name: '',
    email: params.get('email') ?? '',
    password: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validate(registerRequestSchema, values);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setEmailTaken(false);
    setPending(true);
    try {
      // Signed in straight away; the verification email is on its way.
      acceptSignIn(await authApi.register(checked.data));
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.EmailTaken) {
        setErrors({ email: 'Email này đã có tài khoản.' });
        setEmailTaken(true);
      } else {
        setErrors(fieldErrorsFrom(error));
        setFormError(errorMessage(error));
      }
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Tạo tài khoản</CardTitle>
        <CardDescription>Bắt đầu dùng ForgeFlow cho nhóm của bạn</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <FormError message={formError} />
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor="name">Tên</FieldLabel>
              <Input
                id="name"
                autoComplete="name"
                placeholder="Nguyễn Văn An"
                value={values.name}
                onChange={(e) => setValues({ ...values, name: e.target.value })}
                aria-invalid={Boolean(errors.name)}
                autoFocus
              />
              <FieldError>{errors.name}</FieldError>
            </Field>
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
              />
              <FieldError>
                {errors.email}
                {emailTaken ? (
                  <>
                    {' '}
                    <Link href="/login" className="underline underline-offset-4">
                      Đăng nhập
                    </Link>
                  </>
                ) : null}
              </FieldError>
            </Field>
            <Field data-invalid={Boolean(errors.password)}>
              <FieldLabel htmlFor="password">Mật khẩu</FieldLabel>
              <PasswordInput
                id="password"
                autoComplete="new-password"
                value={values.password}
                onChange={(e) => setValues({ ...values, password: e.target.value })}
                aria-invalid={Boolean(errors.password)}
                aria-describedby="password-hint"
              />
              {errors.password ? (
                <FieldError>{errors.password}</FieldError>
              ) : (
                <FieldDescription id="password-hint">
                  Ít nhất {PASSWORD_MIN_LENGTH} ký tự. Cụm từ dài dễ nhớ an toàn hơn mật khẩu ngắn
                  phức tạp.
                </FieldDescription>
              )}
            </Field>
            <SubmitButton pending={pending} className="w-full">
              Tạo tài khoản
            </SubmitButton>
            <GithubSignIn label="Đăng ký bằng GitHub" />
            <p className="text-center text-sm text-muted-foreground">
              Đã có tài khoản?{' '}
              <Link
                href={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`}
                className="text-foreground underline underline-offset-4"
              >
                Đăng nhập
              </Link>
            </p>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
