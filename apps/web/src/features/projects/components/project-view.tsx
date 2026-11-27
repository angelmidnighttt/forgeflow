'use client';

import { can, ErrorCode, updateProjectRequestSchema, type Project } from '@forgeflow/contracts';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/features/account/format-time';
import { useAuth } from '@/features/auth/auth-provider';
import { FormError, FormSuccess } from '@/features/auth/components/form-alert';
import { SubmitButton } from '@/features/auth/components/submit-button';
import { errorMessage } from '@/features/auth/messages';
import { validate, type FieldErrors } from '@/features/auth/validation';
import { useOrganization } from '@/features/organizations/components/organization-scope';
import { ApiError } from '@/lib/api-client';
import { formErrorsFrom, PROJECT_NAME_TAKEN } from '../form-errors';
import { projectsApi } from '../projects-api';
import { EnvironmentsCard } from './environments-card';

type ProjectState =
  | { status: 'loading' }
  | { status: 'ready'; project: Project }
  | { status: 'missing' }
  | { status: 'error'; message: string };

/** One project: its name and its environments. */
export function ProjectView() {
  const organization = useOrganization();
  const { projectId } = useParams<{ projectId: string }>();
  const { withAccessToken } = useAuth();
  const [state, setState] = useState<ProjectState>({ status: 'loading' });
  const projectsHref = `/orgs/${organization.id}/projects`;

  const load = useCallback(async () => {
    try {
      const project = await withAccessToken((t) => projectsApi.get(t, organization.id, projectId));
      setState({ status: 'ready', project });
    } catch (error) {
      const missing =
        error instanceof ApiError &&
        (error.code === ErrorCode.NotFound || error.code === ErrorCode.ValidationFailed);
      setState(missing ? { status: 'missing' } : { status: 'error', message: errorMessage(error) });
    }
  }, [withAccessToken, organization.id, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setProject = (project: Project) => setState({ status: 'ready', project });

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" className="-ml-2.5 self-start" asChild>
        <Link href={projectsHref}>
          <ArrowLeft />
          Tất cả project
        </Link>
      </Button>

      {state.status === 'loading' ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-6" />
        </div>
      ) : null}
      {state.status === 'error' ? <FormError message={state.message} /> : null}
      {state.status === 'missing' ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <h1 className="text-xl font-semibold">Không tìm thấy project</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Project này không tồn tại trong {organization.name}.
          </p>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{state.project.name}</h1>
            <p className="text-sm text-muted-foreground">
              Tạo lúc {formatDateTime(state.project.createdAt)}.
            </p>
          </div>
          <EnvironmentsCard project={state.project} onChange={setProject} />
          {can(organization.role, 'projects.manage') ? (
            <RenameProjectCard project={state.project} onRenamed={setProject} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RenameProjectCard({
  project,
  onRenamed,
}: {
  project: Project;
  onRenamed: (project: Project) => void;
}) {
  const organization = useOrganization();
  const { withAccessToken } = useAuth();
  const [name, setName] = useState(project.name);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validate(updateProjectRequestSchema, { name });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setSaved(false);
    setPending(true);
    try {
      onRenamed(
        await withAccessToken((t) =>
          projectsApi.rename(t, organization.id, project.id, checked.data.name),
        ),
      );
      setSaved(true);
    } catch (error) {
      const shown = formErrorsFrom(error, PROJECT_NAME_TAKEN);
      setErrors(shown.fields);
      setFormError(shown.form);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Đổi tên project</CardTitle>
        <CardDescription>Tên hiển thị cho mọi thành viên của organization.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="max-w-md">
          <FieldGroup>
            {saved ? <FormSuccess>Đã lưu tên mới.</FormSuccess> : null}
            <FormError message={formError} />
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor="project-name">Tên</FieldLabel>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={Boolean(errors.name)}
              />
              <FieldError>{errors.name}</FieldError>
            </Field>
            <div>
              <SubmitButton pending={pending}>Lưu</SubmitButton>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
