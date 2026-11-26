import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RegisterForm } from '@/features/auth/components/register-form';

export const metadata: Metadata = { title: 'Tạo tài khoản' };

export default function RegisterPage() {
  // RegisterForm reads ?next= (useSearchParams), which needs a Suspense boundary.
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
