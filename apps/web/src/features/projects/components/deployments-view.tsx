'use client';

import type { Deployment, DeploymentStatus, Project } from '@forgeflow/contracts';
import { DEPLOYMENT_STATUSES } from '@forgeflow/contracts';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { FormError } from '@/features/auth/components/form-alert';
import { errorMessage } from '@/features/auth/messages';
import {
  commitUrl,
  DEPLOYMENT_STATUS_LABELS,
  deploymentStatusVariant,
  formatDuration,
  safeHref,
} from '@/features/integrations/labels';
import { useOrganization } from '@/features/organizations/components/organization-scope';
import { deploymentsApi, projectsApi } from '../projects-api';

const ALL = 'all';

interface Filters {
  environmentId: string;
  kind: string;
  status: string;
}

/** Every deployment and CI run of a project, newest first, with filters. */
export function DeploymentsView() {
  const organization = useOrganization();
  const { projectId } = useParams<{ projectId: string }>();
  const { withAccessToken } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [filters, setFilters] = useState<Filters>({ environmentId: ALL, kind: ALL, status: ALL });
  const [deployments, setDeployments] = useState<Deployment[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void withAccessToken((t) => projectsApi.get(t, organization.id, projectId))
      .then(setProject)
      .catch((loadError: unknown) => setError(errorMessage(loadError)));
  }, [withAccessToken, organization.id, projectId]);

  // Each first page (new filters) starts a new list; an answer for an older list is dropped, so a
  // slow page of the previous filters never lands in this one.
  const listRef = useRef(0);

  const load = useCallback(
    async (cursor?: string) => {
      const list = cursor ? listRef.current : ++listRef.current;
      setError(null);
      try {
        const page = await withAccessToken((t) =>
          deploymentsApi.list(t, organization.id, projectId, {
            environmentId: filters.environmentId === ALL ? undefined : filters.environmentId,
            kind: filters.kind === ALL ? undefined : filters.kind,
            status: filters.status === ALL ? undefined : filters.status,
            cursor,
          }),
        );
        if (list !== listRef.current) return;
        setDeployments((previous) =>
          cursor ? [...(previous ?? []), ...page.deployments] : page.deployments,
        );
        setNextCursor(page.nextCursor);
      } catch (loadError) {
        if (list === listRef.current) setError(errorMessage(loadError));
      }
    },
    [withAccessToken, organization.id, projectId, filters],
  );

  useEffect(() => {
    setDeployments(null);
    setNextCursor(null);
    void load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    await load(nextCursor);
    setLoadingMore(false);
  }

  const setFilter = (key: keyof Filters) => (value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" className="-ml-2.5 self-start" asChild>
        <Link href={`/orgs/${organization.id}/projects/${projectId}`}>
          <ArrowLeft />
          {project?.name ?? 'Project'}
        </Link>
      </Button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Deployment</h1>
        <p className="text-sm text-muted-foreground">
          Mọi lần deploy và lần chạy CI của {project?.name ?? 'project'}: từ GitHub, hoặc do
          pipeline báo qua API token.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={filters.environmentId} onValueChange={setFilter('environmentId')}>
          <SelectTrigger className="min-w-44" aria-label="Lọc theo environment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Mọi environment</SelectItem>
            {project?.environments.map((environment) => (
              <SelectItem key={environment.id} value={environment.id}>
                {environment.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.kind} onValueChange={setFilter('kind')}>
          <SelectTrigger className="min-w-40" aria-label="Lọc theo loại">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Deploy và CI</SelectItem>
            <SelectItem value="deployment">Chỉ deploy</SelectItem>
            <SelectItem value="workflow_run">Chỉ CI</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={setFilter('status')}>
          <SelectTrigger className="min-w-40" aria-label="Lọc theo trạng thái">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Mọi trạng thái</SelectItem>
            {DEPLOYMENT_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {DEPLOYMENT_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <FormError message={error} />
          {deployments === null && !error ? (
            <div className="flex justify-center py-6">
              <Spinner className="size-5" />
            </div>
          ) : null}
          {deployments?.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Chưa có deployment nào. Gắn một repository GitHub vào project (trang Tích hợp), hoặc
              báo deploy từ pipeline bằng API token.
            </p>
          ) : null}
          {deployments && deployments.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Phiên bản</TableHead>
                  <TableHead>Nơi deploy</TableHead>
                  <TableHead className="hidden md:table-cell">Người deploy</TableHead>
                  <TableHead>Lúc</TableHead>
                  <TableHead className="hidden sm:table-cell">Thời lượng</TableHead>
                  <TableHead>
                    <span className="sr-only">Log</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deployments.map((deployment) => (
                  <DeploymentRow key={deployment.id} deployment={deployment} />
                ))}
              </TableBody>
            </Table>
          ) : null}
          {nextCursor ? (
            <div className="flex justify-center">
              <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? <Spinner /> : null}
                Xem thêm
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function DeploymentRow({ deployment }: { deployment: Deployment }) {
  const commit = commitUrl(deployment.repository, deployment.sha);
  const logs = safeHref(deployment.url);
  const status: DeploymentStatus = deployment.status;
  return (
    <TableRow>
      <TableCell>
        <Badge variant={deploymentStatusVariant(status)}>{DEPLOYMENT_STATUS_LABELS[status]}</Badge>
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="font-medium">{deployment.version ?? '—'}</div>
        {deployment.sha ? (
          commit ? (
            <a
              href={commit}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-muted-foreground hover:underline"
            >
              {deployment.sha.slice(0, 7)}
            </a>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">
              {deployment.sha.slice(0, 7)}
            </span>
          )
        ) : null}
      </TableCell>
      <TableCell>
        {deployment.environment ? (
          deployment.environment.name
        ) : (
          <span className="text-muted-foreground">CI · {deployment.workflow ?? 'workflow'}</span>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell">{deployment.creator ?? '—'}</TableCell>
      <TableCell className="text-muted-foreground">
        <time dateTime={deployment.createdAt} title={formatDateTime(deployment.createdAt)}>
          {formatRelative(deployment.createdAt)}
        </time>
      </TableCell>
      <TableCell className="hidden text-muted-foreground sm:table-cell">
        {formatDuration(deployment.durationSeconds)}
      </TableCell>
      <TableCell className="text-right">
        {logs ? (
          <a
            href={logs}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
          >
            Log <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
