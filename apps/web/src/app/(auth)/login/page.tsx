import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/features/auth/components/login-form';

export const metadata: Metadata = { title: 'Đăng nhập' };

export default function LoginPage() {
  // LoginForm reads ?next= and ?error= (useSearchParams), which needs a Suspense boundary
  // so the rest of the page can still be prerendered.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
