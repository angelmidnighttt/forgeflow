import type { Metadata } from 'next';
import { AuditLogView } from '@/features/organizations/components/audit-log-view';

export const metadata: Metadata = { title: 'Nhật ký hoạt động' };

export default function AuditLogPage() {
  return <AuditLogView />;
}
