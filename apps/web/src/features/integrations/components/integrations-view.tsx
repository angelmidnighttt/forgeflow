'use client';

import {
  can,
  type GithubApp,
  type Integration,
  type OutboxEvent,
  type Project,
  type Repository,
  type WebhookDelivery,
} from '@forgeflow/contracts';
import { ExternalLink, Lock, RotateCcw } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { GithubMark } from '@/components/github-mark';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatRelative } from '@/features/account/format-time';
import { useAuth } from '@/features/auth/auth-provider';
import { FormError, FormSuccess } from '@/features/auth/components/form-alert';
import { errorMessage } from '@/features/auth/messages';
import { useOrganization } from '@/features/organizations/components/organization-scope';
import { projectsApi } from '@/features/projects/projects-api';
import { integrationsApi } from '../integrations-api';
import { EVENT_STATUS_LABELS, githubSetupErrorMessage, safeHref } from '../labels';

/** Not mapped: deployments of the repository go nowhere. */
const NO_PROJECT = 'none';

/** The organization's integrations: the GitHub App, and background work that failed. */
export function IntegrationsView() {
  const organization = useOrganization();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tích hợp</h1>
        <p className="text-sm text-muted-foreground">
          Kết nối {organization.name} với công cụ bạn đang dùng, để ForgeFlow thấy được các lần
          deploy.
        </p>
      </div>
      <Suspense fallback={null}>
        <SetupResult />
      </Suspense>
      <GithubSection />
      {can(organization.role, 'integrations.manage') ? <DeadEventsCard /> : null}
    </div>
  );
}

/** What GitHub's redirect after installing the App says (?github= / ?github_error=). */
function SetupResult() {
  const params = useSearchParams();
  const error = githubSetupErrorMessage(params.get('github_error'));
  if (error) return <FormError message={error} />;
  if (params.get('github') === 'connected') {
    return (
      <FormSuccess title="Đã kết nối GitHub">
        Hãy gắn từng repository vào project để deployment của nó xuất hiện trong ForgeFlow.
      </FormSuccess>
    );
  }
  if (params.get('github') === 'requested') {
    return (
      <FormSuccess title="Đã gửi yêu cầu cài đặt">
        Một chủ sở hữu của tài khoản GitHub cần duyệt yêu cầu cài ForgeFlow.
      </FormSuccess>
    );
  }
  return null;
}

function GithubSection() {
  const organization = useOrganization();
  const { withAccessToken } = useAuth();
  const canManage = can(organization.role, 'integrations.manage');
  const [app, setApp] = useState<GithubApp | null>(null);
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [githubApp, list, projectList] = await withAccessToken((t) =>
        Promise.all([
          integrationsApi.githubApp(t),
          integrationsApi.list(t, organization.id),
          projectsApi.list(t, organization.id),
        ]),
      );
      setApp(githubApp);
      setIntegrations(list.filter((integration) => integration.kind === 'github'));
      setProjects(projectList);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [withAccessToken, organization.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await withAccessToken((t) =>
        integrationsApi.installGithub(t, organization.id),
      );
      window.location.assign(url);
    } catch (connectError) {
      setError(errorMessage(connectError));
      setConnecting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2">
            <GithubMark className="size-5" />
            GitHub
          </CardTitle>
          <CardDescription>
            Cài GitHub App của ForgeFlow lên tài khoản hoặc organization GitHub: deployment và các
            lần chạy GitHub Actions của repository được ghi lại tự động.
          </CardDescription>
        </div>
        {app?.configured && canManage ? (
          <Button onClick={() => void connect()} disabled={connecting}>
            {connecting ? <Spinner /> : <GithubMark />}
            Kết nối GitHub
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <FormError message={error} />
        {integrations === null && !error ? (
          <div className="flex justify-center py-4">
            <Spinner className="size-5" />
          </div>
        ) : null}
        {app && !app.configured ? (
          <p className="text-sm text-muted-foreground">
            Máy chủ này chưa cấu hình GitHub App (biến môi trường GITHUB_APP_*). Pipeline vẫn báo
            deploy được bằng API token của project.
          </p>
        ) : null}
        {app?.configured && integrations?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Chưa kết nối tài khoản GitHub nào.
            {canManage ? '' : ' Chủ sở hữu hoặc quản trị viên sẽ kết nối.'}
          </p>
        ) : null}
        {integrations?.map((integration) => (
          <GithubInstallation
            key={integration.id}
            integration={integration}
            projects={projects}
            canManage={canManage}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function GithubInstallation({
  integration,
  projects,
  canManage,
}: {
  integration: Integration;
  projects: Project[];
  canManage: boolean;
}) {
  const organization = useOrganization();
  const { withAccessToken } = useAuth();
  const [repositories, setRepositories] = useState<Repository[] | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const account =
    typeof integration.config.account === 'string' ? integration.config.account : null;
  const settingsUrl =
    typeof integration.config.htmlUrl === 'string' ? safeHref(integration.config.htmlUrl) : null;

  const load = useCallback(async () => {
    try {
      const [repos, recent] = await withAccessToken((t) =>
        Promise.all([
          integrationsApi.repositories(t, organization.id, integration.id),
          integrationsApi.deliveries(t, organization.id, integration.id),
        ]),
      );
      setRepositories(repos);
      setDeliveries(recent);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [withAccessToken, organization.id, integration.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function map(repository: Repository, value: string) {
    setSaving(repository.id);
    setError(null);
    try {
      const updated = await withAccessToken((t) =>
        integrationsApi.mapRepository(
          t,
          organization.id,
          repository.id,
          value === NO_PROJECT ? null : value,
        ),
      );
      setRepositories((list) => list?.map((r) => (r.id === updated.id ? updated : r)) ?? null);
    } catch (mapError) {
      setError(errorMessage(mapError));
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{account ?? integration.name}</h3>
        <Badge variant={integration.status === 'active' ? 'secondary' : 'destructive'}>
          {integration.status === 'active' ? 'Đang hoạt động' : 'Đã tắt'}
        </Badge>
        {settingsUrl ? (
          <a
            href={settingsUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
          >
            Cài đặt trên GitHub <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </div>
      {integration.status !== 'active' ? (
        <p className="text-sm text-muted-foreground">
          GitHub App đã bị gỡ hoặc tạm ngưng trên GitHub. Kết nối lại để tiếp tục nhận deployment.
        </p>
      ) : null}
      <FormError message={error} />
      {repositories === null && !error ? <Spinner className="size-5" /> : null}
      {repositories?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Bản cài đặt chưa có quyền với repository nào.
        </p>
      ) : null}
      {repositories && repositories.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Repository</TableHead>
              <TableHead>Project nhận deployment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {repositories.map((repository) => {
              const project = projects.find((p) => p.id === repository.projectId);
              return (
                <TableRow key={repository.id}>
                  <TableCell>
                    <a
                      href={safeHref(repository.htmlUrl) ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 font-medium hover:underline"
                    >
                      {repository.private ? (
                        <Lock className="size-3.5" aria-label="Riêng tư" />
                      ) : null}
                      {repository.fullName}
                    </a>
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <Select
                        value={repository.projectId ?? NO_PROJECT}
                        onValueChange={(value) => void map(repository, value)}
                        disabled={saving === repository.id}
                      >
                        <SelectTrigger
                          className="min-w-48"
                          aria-label={`Project của ${repository.fullName}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_PROJECT}>Không gắn</SelectItem>
                          {projects.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm">{project?.name ?? 'Không gắn'}</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">Webhook gần đây</h4>
        {deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa nhận webhook nào.</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {deliveries.slice(0, 10).map((delivery) => (
              <li key={delivery.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <code className="text-xs">
                  {delivery.event}
                  {delivery.action ? `.${delivery.action}` : ''}
                </code>
                {delivery.status ? (
                  <Badge variant={delivery.status === 'dead' ? 'destructive' : 'outline'}>
                    {EVENT_STATUS_LABELS[delivery.status]}
                  </Badge>
                ) : null}
                <time
                  dateTime={delivery.receivedAt}
                  title={formatDateTime(delivery.receivedAt)}
                  className="ml-auto text-muted-foreground"
                >
                  {formatRelative(delivery.receivedAt)}
                </time>
                {delivery.lastError ? (
                  <p className="w-full text-xs text-destructive">{delivery.lastError}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Background work that failed for good (owners and admins), with a way to run it again. */
function DeadEventsCard() {
  const organization = useOrganization();
  const { withAccessToken } = useAuth();
  const [events, setEvents] = useState<OutboxEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEvents(await withAccessToken((t) => integrationsApi.deadEvents(t, organization.id)));
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [withAccessToken, organization.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function retry(event: OutboxEvent) {
    setRetrying(event.id);
    setError(null);
    try {
      await withAccessToken((t) => integrationsApi.retryEvent(t, organization.id, event.id));
      await load();
    } catch (retryError) {
      setError(errorMessage(retryError));
    } finally {
      setRetrying(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sự kiện xử lý lỗi</CardTitle>
        <CardDescription>
          Webhook hoặc việc nền đã thử nhiều lần vẫn lỗi. Sửa nguyên nhân (ví dụ quyền của GitHub
          App) rồi chạy lại.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FormError message={error} />
        {events?.length === 0 ? (
          <p className="text-sm text-muted-foreground">Không có sự kiện nào bị lỗi.</p>
        ) : null}
        {events && events.length > 0 ? (
          <ul className="flex flex-col divide-y text-sm">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center gap-2 py-2">
                <code className="text-xs">{event.summary ?? event.topic}</code>
                <span className="text-muted-foreground">
                  {event.attempts} lần thử · {formatRelative(event.createdAt)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  disabled={retrying === event.id}
                  onClick={() => void retry(event)}
                >
                  {retrying === event.id ? <Spinner /> : <RotateCcw />}
                  Chạy lại
                </Button>
                {event.lastError ? (
                  <p className="w-full text-xs text-destructive">{event.lastError}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
