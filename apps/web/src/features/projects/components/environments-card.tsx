'use client';

import {
  can,
  createEnvironmentRequestSchema,
  updateEnvironmentRequestSchema,
  type Environment,
  type Project,
} from '@forgeflow/contracts';
import { Pencil, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useAuth } from '@/features/auth/auth-provider';
import { FormError } from '@/features/auth/components/form-alert';
import { SubmitButton } from '@/features/auth/components/submit-button';
import { validate, type FieldErrors } from '@/features/auth/validation';
import { useOrganization } from '@/features/organizations/components/organization-scope';
import { ENVIRONMENT_NAME_TAKEN, formErrorsFrom } from '../form-errors';
import { withAddedEnvironment, withEnvironment } from '../project-state';
import { projectsApi } from '../projects-api';

/**
 * A project's environments, in order. Owners and admins rename them, add new ones and protect
 * or unprotect them; the API checks every change again.
 */
export function EnvironmentsCard({
  project,
  onChange,
}: {
  project: Project;
  onChange: (project: Project) => void;
}) {
  const organization = useOrganization();
  const canManage = can(organization.role, 'projects.manage');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Environment</CardTitle>
        <CardDescription>
          Nơi project chạy. Environment được bảo vệ cần người duyệt trước khi ForgeFlow thay đổi nó
          (khi có tính năng khắc phục tự động).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tên</TableHead>
              <TableHead>Bảo vệ</TableHead>
              {canManage ? (
                <TableHead className="text-right">
                  <span className="sr-only">Thao tác</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {project.environments.map((environment) => (
              <EnvironmentRow
                key={environment.id}
                project={project}
                environment={environment}
                onChange={(updated) => onChange(withEnvironment(project, updated))}
              />
            ))}
          </TableBody>
        </Table>
        {canManage ? (
          <AddEnvironmentForm
            project={project}
            onAdded={(added) => onChange(withAddedEnvironment(project, added))}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function EnvironmentRow({
  project,
  environment,
  onChange,
}: {
  project: Project;
  environment: Environment;
  onChange: (environment: Environment) => void;
}) {
  const organization = useOrganization();
  const { withAccessToken } = useAuth();
  const canManage = can(organization.role, 'projects.manage');
  const canProtect = can(organization.role, 'environments.protect');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(environment.name);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [rowError, setRowError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function update(body: { name?: string; protected?: boolean }): Promise<boolean> {
    setRowError(null);
    setPending(true);
    try {
      onChange(
        await withAccessToken((t) =>
          projectsApi.updateEnvironment(t, organization.id, project.id, environment.id, body),
        ),
      );
      return true;
    } catch (error) {
      const shown = formErrorsFrom(error, ENVIRONMENT_NAME_TAKEN);
      setErrors(shown.fields);
      setRowError(shown.form);
      return false;
    } finally {
      setPending(false);
    }
  }

  async function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validate(updateEnvironmentRequestSchema, { name });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    if (checked.data.name === environment.name) {
      setEditing(false);
      return;
    }
    if (await update({ name: checked.data.name })) setEditing(false);
  }

  function cancelEditing() {
    setEditing(false);
    setName(environment.name);
    setErrors({});
    setRowError(null);
  }

  return (
    <TableRow>
      <TableCell className="align-top">
        {editing ? (
          <form onSubmit={onRename} noValidate className="flex flex-col gap-2">
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor={`environment-${environment.id}`} className="sr-only">
                Tên mới của {environment.name}
              </FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id={`environment-${environment.id}`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-invalid={Boolean(errors.name)}
                  className="h-8 w-48"
                  autoFocus
                />
                <SubmitButton size="sm" pending={pending}>
                  Lưu
                </SubmitButton>
                <Button type="button" variant="ghost" size="sm" onClick={cancelEditing}>
                  Huỷ
                </Button>
              </div>
              <FieldError>{errors.name}</FieldError>
            </Field>
          </form>
        ) : (
          <span className="font-medium">{environment.name}</span>
        )}
        <FormError message={rowError} />
      </TableCell>
      <TableCell className="align-top">
        {environment.protected ? (
          <Badge variant="secondary">
            <ShieldCheck />
            Được bảo vệ
          </Badge>
        ) : (
          <span className="text-sm text-muted-foreground">Không</span>
        )}
      </TableCell>
      {canManage ? (
        <TableCell className="text-right align-top">
          <div className="flex justify-end gap-1">
            {!editing ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setName(environment.name);
                  setEditing(true);
                }}
              >
                <Pencil />
                Đổi tên
              </Button>
            ) : null}
            {canProtect && environment.protected ? (
              <ConfirmDialog
                trigger={
                  <Button variant="outline" size="sm" disabled={pending}>
                    {pending ? <Spinner /> : <ShieldOff />}
                    Tắt bảo vệ
                  </Button>
                }
                title={`Tắt bảo vệ cho ${environment.name}?`}
                description="Thay đổi trên environment này sẽ không còn cần người duyệt. Việc này được ghi vào nhật ký hoạt động."
                confirmLabel="Tắt bảo vệ"
                onConfirm={() => void update({ protected: false })}
              />
            ) : null}
            {canProtect && !environment.protected ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => void update({ protected: true })}
              >
                {pending ? <Spinner /> : <ShieldCheck />}
                Bật bảo vệ
              </Button>
            ) : null}
          </div>
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function AddEnvironmentForm({
  project,
  onAdded,
}: {
  project: Project;
  onAdded: (environment: Environment) => void;
}) {
  const organization = useOrganization();
  const { withAccessToken } = useAuth();
  const canProtect = can(organization.role, 'environments.protect');
  const [name, setName] = useState('');
  const [protect, setProtect] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validate(createEnvironmentRequestSchema, {
      name,
      protected: canProtect && protect,
    });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      onAdded(
        await withAccessToken((t) =>
          projectsApi.addEnvironment(t, organization.id, project.id, checked.data),
        ),
      );
      setName('');
      setProtect(false);
    } catch (error) {
      const shown = formErrorsFrom(error, ENVIRONMENT_NAME_TAKEN);
      setErrors(shown.fields);
      setFormError(shown.form);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-md border-t pt-6">
      <FieldGroup>
        <FormError message={formError} />
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor="environment-name">Thêm environment</FieldLabel>
          <Input
            id="environment-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: preview, production-eu"
            aria-invalid={Boolean(errors.name)}
          />
          <FieldError>{errors.name}</FieldError>
        </Field>
        {canProtect ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={protect}
              onChange={(e) => setProtect(e.target.checked)}
              className="size-4 accent-primary"
            />
            Bảo vệ environment này ngay
          </label>
        ) : null}
        <div>
          <SubmitButton pending={pending}>Thêm environment</SubmitButton>
        </div>
      </FieldGroup>
    </form>
  );
}
