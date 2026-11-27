import type { Metadata } from 'next';
import { DeploymentsView } from '@/features/projects/components/deployments-view';

export const metadata: Metadata = { title: 'Deployment' };

export default function DeploymentsPage() {
  return <DeploymentsView />;
}
