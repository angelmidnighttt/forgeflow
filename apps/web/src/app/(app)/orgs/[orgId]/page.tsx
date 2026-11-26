import type { Metadata } from 'next';
import { OverviewView } from '@/features/organizations/components/overview-view';

export const metadata: Metadata = { title: 'Tổng quan' };

export default function OrganizationPage() {
  return <OverviewView />;
}
