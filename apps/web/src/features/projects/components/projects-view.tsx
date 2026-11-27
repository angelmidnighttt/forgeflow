'use client';

import { can, createProjectRequestSchema, type Project } from '@forgeflow/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/features/account/format-time';
import { useAuth } from '@/features/auth/auth-provider';
import { FormError } from '@/features/auth/components/form-alert';
import { SubmitButton } from '@/features/auth/components/submit-button';
import { errorMessage } from '@/features/auth/messages';
import { validate, type FieldErrors } from '@/features/auth/validation';
import { useOrganization } from '@/features/organizations/components/organization-scope';
import { formErrorsFrom, PROJECT_NAME_TAKEN } from '../form-errors';
import { projectsApi } from '../projects-api';
import { EnvironmentBadges } from './environment-badges';

/** The organization's projects; owners and admins also create them here. */
export function ProjectsView() {
  const organization = useOrganization();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Project</h1>
        <p className="text-sm text-muted-foreground">
          Các ứng dụng và dịch vụ mà {organization.name} vận hành, mỗi project với các environment
          của nó.
        </p>
      </div>
      {can(organization.role, 'projects.manage') ? <CreateProjectCard /> : null}
      <ProjectsCard />
    </div>
  );
}

function CreateProjectCard() {
  const organization = useOrganization();
  const { withAccessToken } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validate(createProjectRequestSchema, { name });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      const project = await withAccessToken((t) =>
        projectsApi.create(t, organization.id, checked.data.name),
      );
      router.push(`/orgs/${organization.id}/projects/${project.id}`);
    } catch (error) {
      const shown = formErrorsFrom(error, PROJECT_NAME_TAKEN);
      setErrors(shown.fields);
      setFormError(shown.form);
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tạo project</CardTitle>
        <CardDescription>
          Project mới có sẵn ba environment: development, staging và production (được bảo vệ).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="max-w-md">
          <FieldGroup>
            <FormError message={formError} />
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor="project-name">Tên project</FieldLabel>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ví dụ: Cổng thanh toán"
                aria-invalid={Boolean(errors.name)}
              />
              <FieldError>{errors.name}</FieldError>
            </Field>
            <div>
              <SubmitButton pending={pending}>Tạo project</SubmitButton>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

function ProjectsCard() {
  const organization = useOrganization();
  const { withAccessToken } = useAuth();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProjects(await withAccessToken((t) => projectsApi.list(t, organization.id)));
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [withAccessToken, organization.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Các project{projects ? ` (${projects.length})` : ''}</CardTitle>
        <CardDescription>
          Biểu tượng khiên đánh dấu environment được bảo vệ: thay đổi trên đó cần người duyệt.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FormError message={error} />
        {projects === null && !error ? (
          <div className="flex justify-center py-4">
            <Spinner className="size-5" />
          </div>
        ) : null}
        {projects?.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Chưa có project nào.
            {can(organization.role, 'projects.manage')
              ? ' Tạo project đầu tiên ở trên.'
              : ' Chủ sở hữu hoặc quản trị viên sẽ tạo project.'}
          </p>
        ) : null}
        {projects && projects.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tên</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead className="hidden sm:table-cell">Tạo lúc</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/orgs/${organization.id}/projects/${project.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <EnvironmentBadges environments={project.environments} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {formatDateTime(project.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
