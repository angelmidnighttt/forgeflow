import type { Metadata } from 'next';
import { IntegrationsView } from '@/features/integrations/components/integrations-view';

export const metadata: Metadata = { title: 'Tích hợp' };

export default function IntegrationsPage() {
  return <IntegrationsView />;
}
