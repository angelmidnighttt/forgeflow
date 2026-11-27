'use client';

import { createApiTokenRequestSchema, type ApiToken, type Project } from '@forgeflow/contracts';
import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatRelative } from '@/features/account/format-time';
import { useAuth } from '@/features/auth/auth-provider';
import { FormError, FormSuccess } from '@/features/auth/components/form-alert';
import { SubmitButton } from '@/features/auth/components/submit-button';
import { errorMessage } from '@/features/auth/messages';
import { fieldErrorsFrom, validate, type FieldErrors } from '@/features/auth/validation';
import { useOrganization } from '@/features/organizations/components/organization-scope';
import { API_TOKEN_STATE_LABELS, apiTokenState } from '../api-token-state';
import { deploymentsApi } from '../projects-api';

const NEVER = 'never';

/**
 * API tokens of the project, for pipelines that report deployments (owners and admins). A new
 * token's secret is shown once, right after it is created.
 */
export function ApiTokensCard({ project }: { project: Project }) {
  const organization = useOrganization();
  const { withAccessToken } = useAuth();
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [name, setName] = useState('');
  const [expires, setExpires] = useState(NEVER);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      setTokens(
        await withAccessToken((t) => deploymentsApi.tokens(t, organization.id, project.id)),
      );
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [withAccessToken, organization.id, project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validate(createApiTokenRequestSchema, {
      name,
      ...(expires === NEVER ? {} : { expiresInDays: Number(expires) }),
    });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setError(null);
    setPending(true);
    try {
      const created = await withAccessToken((t) =>
        deploymentsApi.createToken(t, organization.id, project.id, checked.data),
      );
      setSecret(created.secret);
      setCopied(false);
      setName('');
      await load();
    } catch (createError) {
      setErrors(fieldErrorsFrom(createError));
      setError(errorMessage(createError));
    } finally {
      setPending(false);
    }
  }

  async function revoke(token: ApiToken) {
    setError(null);
    try {
      await withAccessToken((t) =>
        deploymentsApi.revokeToken(t, organization.id, project.id, token.id),
      );
      await load();
    } catch (revokeError) {
      setError(errorMessage(revokeError));
    }
  }

  async function copy() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>API token</CardTitle>
        <CardDescription>
          Cho pipeline không dùng GitHub Deployments (GitLab CI, Jenkins, script…) báo deploy của
          project này: <code>tools/report-deployment.sh</code> hoặc action{' '}
          <code>report-deployment</code> của ForgeFlow.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {secret ? (
          <FormSuccess title="Token mới: sao chép ngay, nó chỉ hiện một lần">
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted px-2 py-1 text-xs break-all">{secret}</code>
              <Button variant="outline" size="sm" onClick={() => void copy()}>
                {copied ? <Check /> : <Copy />}
                {copied ? 'Đã sao chép' : 'Sao chép'}
              </Button>
            </div>
          </FormSuccess>
        ) : null}
        <FormError message={error} />

        <form onSubmit={onCreate} noValidate className="flex flex-wrap items-end gap-3">
          <FieldGroup className="flex-1">
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor="token-name">Tên token</FieldLabel>
              <Input
                id="token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ví dụ: GitLab CI production"
                aria-invalid={Boolean(errors.name)}
              />
              <FieldError>{errors.name}</FieldError>
            </Field>
          </FieldGroup>
          <Select value={expires} onValueChange={setExpires}>
            <SelectTrigger className="min-w-36" aria-label="Thời hạn">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NEVER}>Không hết hạn</SelectItem>
              <SelectItem value="30">30 ngày</SelectItem>
              <SelectItem value="90">90 ngày</SelectItem>
              <SelectItem value="365">1 năm</SelectItem>
            </SelectContent>
          </Select>
          <SubmitButton pending={pending}>Tạo token</SubmitButton>
        </form>

        {tokens && tokens.length > 0 ? (
          <ul className="flex flex-col divide-y text-sm">
            {tokens.map((token) => {
              const state = apiTokenState(token);
              return (
                <li key={token.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-medium">{token.name}</span>
                  <code className="text-xs text-muted-foreground">{token.prefix}…</code>
                  <Badge variant={state === 'active' ? 'secondary' : 'outline'}>
                    {API_TOKEN_STATE_LABELS[state]}
                  </Badge>
                  <span className="text-muted-foreground">
                    {token.lastUsedAt ? `dùng ${formatRelative(token.lastUsedAt)}` : 'chưa dùng'}
                  </span>
                  {state === 'active' ? (
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="sm" className="ml-auto">
                          Thu hồi
                        </Button>
                      }
                      title={`Thu hồi token ${token.name}?`}
                      description="Pipeline đang dùng token này sẽ không báo deploy được nữa."
                      confirmLabel="Thu hồi"
                      onConfirm={() => void revoke(token)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
