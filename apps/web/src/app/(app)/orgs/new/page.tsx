import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CreateOrganizationForm } from '@/features/organizations/components/create-organization-form';

export const metadata: Metadata = { title: 'Tạo organization' };

export default function NewOrganizationPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tạo organization</CardTitle>
        <CardDescription>Bạn sẽ là chủ sở hữu, rồi có thể mời đồng đội.</CardDescription>
      </CardHeader>
      <CardContent>
        <CreateOrganizationForm />
      </CardContent>
    </Card>
  );
}
