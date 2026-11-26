import type { Metadata } from 'next';
import { AccountView } from '@/features/account/components/account-view';

export const metadata: Metadata = { title: 'Tài khoản' };

export default function AccountPage() {
  return <AccountView />;
}
