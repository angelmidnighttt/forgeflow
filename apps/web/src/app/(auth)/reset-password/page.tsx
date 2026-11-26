import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/features/auth/components/reset-password-form';

// The token is in the URL fragment; keep it out of the Referer of anything this page loads.
export const metadata: Metadata = { title: 'Đặt lại mật khẩu', referrer: 'no-referrer' };

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
