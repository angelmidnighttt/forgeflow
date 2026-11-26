import type { Metadata } from 'next';
import { VerifyEmailView } from '@/features/auth/components/verify-email-view';

export const metadata: Metadata = { title: 'Xác minh email', referrer: 'no-referrer' };

export default function VerifyEmailPage() {
  return <VerifyEmailView />;
}
