import type { Metadata } from 'next';
import { SettingsView } from '@/features/organizations/components/settings-view';

export const metadata: Metadata = { title: 'Cài đặt organization' };

export default function OrganizationSettingsPage() {
  return <SettingsView />;
}
