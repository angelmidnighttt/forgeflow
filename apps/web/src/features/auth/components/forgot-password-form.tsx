'use client';

import { forgotPasswordRequestSchema } from '@forgeflow/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authApi } from '../auth-api';
import { errorMessage } from '../messages';
import { fieldErrorsFrom, validate, type FieldErrors } from '../validation';
import { FormError, FormSuccess } from './form-alert';
import { SubmitButton } from './submit-button';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validate(forgotPasswordRequestSchema, { email });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      await authApi.forgotPassword(checked.data);
      setSentTo(checked.data.email);
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Quên mật khẩu</CardTitle>
        <CardDescription>
          Nhập email của tài khoản, chúng tôi sẽ gửi link đặt lại mật khẩu
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sentTo ? (
          <FieldGroup>
            {/* The API answers the same whether or not the email has an account, and so does this. */}
            <FormSuccess title="Kiểm tra hộp thư của bạn">
              Nếu <strong>{sentTo}</strong> có tài khoản ForgeFlow, bạn sẽ nhận được email kèm link
              đặt lại mật khẩu trong vài phút. Link dùng được một lần và hết hạn sau 1 giờ.
            </FormSuccess>
            <Button variant="outline" asChild>
              <Link href="/login">Quay lại đăng nhập</Link>
            </Button>
          </FieldGroup>
        ) : (
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
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={Boolean(errors.email)}
                  autoFocus
                />
                <FieldError>{errors.email}</FieldError>
              </Field>
              <SubmitButton pending={pending} className="w-full">
                Gửi link đặt lại mật khẩu
              </SubmitButton>
              <p className="text-center text-sm text-muted-foreground">
                Nhớ ra rồi?{' '}
                <Link href="/login" className="text-foreground underline underline-offset-4">
                  Đăng nhập
                </Link>
              </p>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
