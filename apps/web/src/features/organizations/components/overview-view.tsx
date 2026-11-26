'use client';

import { can } from '@forgeflow/contracts';
import { Users } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSignedInUser } from '@/features/auth/auth-provider';
import { SystemStatus } from '@/features/system-status/system-status';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../roles';
import { useOrganization } from './organization-scope';

export function OverviewView() {
  const organization = useOrganization();
  const user = useSignedInUser();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{organization.name}</h1>
        <Badge variant="secondary" title={ROLE_DESCRIPTIONS[organization.role]}>
          {ROLE_LABELS[organization.role]}
        </Badge>
      </div>
      <p className="-mt-4 text-sm text-muted-foreground">
        Xin chào{user.name ? `, ${user.name}` : ''}. Đây là trang tổng quan của organization.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Thành viên</CardTitle>
          <CardDescription>
            {can(organization.role, 'members.manage')
              ? 'Mời đồng đội và chọn vai trò cho từng người.'
              : 'Xem ai đang làm việc trong organization.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <Link href={`/orgs/${organization.id}/members`}>
              <Users />
              {can(organization.role, 'invitations.manage')
                ? 'Quản lý thành viên'
                : 'Xem thành viên'}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sắp có</CardTitle>
          <CardDescription>Các phần tiếp theo của ForgeFlow</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Dự án và môi trường, deployment, cảnh báo và sự cố sẽ xuất hiện ở đây trong các bản phát
          hành tới.
        </CardContent>
      </Card>

      <SystemStatus />
    </div>
  );
}
