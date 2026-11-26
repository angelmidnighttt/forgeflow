'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useSignedInUser } from '@/features/auth/auth-provider';
import { FormError } from '@/features/auth/components/form-alert';
import { CreateOrganizationForm } from '@/features/organizations/components/create-organization-form';
import { pickOrganization, readLastOrganization } from '@/features/organizations/last-organization';
import { useOrganizations } from '@/features/organizations/organizations-provider';

/**
 * "/": opens the organization used last (or the first one); a user without any organization
 * gets the first-run screen to create one.
 */
export function HomeView() {
  const user = useSignedInUser();
  const { state } = useOrganizations();
  const router = useRouter();
  const target =
    state.status === 'ready'
      ? pickOrganization(
          state.organizations.map((organization) => organization.id),
          readLastOrganization(),
        )
      : undefined;

  useEffect(() => {
    if (target) router.replace(`/orgs/${target}`);
  }, [target, router]);

  if (state.status === 'error') return <FormError message={state.message} />;
  if (state.status === 'loading' || target) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Chào mừng{user.name ? `, ${user.name}` : ''} đến với ForgeFlow
        </h1>
        <p className="text-sm text-muted-foreground">
          Mọi thứ trong ForgeFlow (dự án, deployment, sự cố) thuộc về một organization. Hãy tạo
          organization đầu tiên của bạn.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tạo organization</CardTitle>
          <CardDescription>
            Bạn sẽ là chủ sở hữu, rồi có thể mời đồng đội. Được mời vào organization khác? Mở link
            trong email mời.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateOrganizationForm />
        </CardContent>
      </Card>
    </div>
  );
}
