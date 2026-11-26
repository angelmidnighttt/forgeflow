import type { Metadata } from 'next';
import { MembersView } from '@/features/organizations/components/members-view';

export const metadata: Metadata = { title: 'Thành viên' };

export default function MembersPage() {
  return <MembersView />;
}
