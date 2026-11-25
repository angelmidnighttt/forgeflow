'use client';

import {
  healthSchema,
  readinessSchema,
  successEnvelope,
  type Health,
  type Readiness,
} from '@forgeflow/contracts';
import { useEffect, useState } from 'react';

const REFRESH_MS = 10_000;
const healthBody = successEnvelope(healthSchema);
const readinessBody = successEnvelope(readinessSchema);

interface Snapshot {
  health: Health | null;
  readiness: Readiness | null;
  checkedAt: Date;
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(path, { cache: 'no-store' });
  // /ready answers 503 with a body when a dependency is down, so read the body either way.
  return res.json();
}

async function loadSnapshot(): Promise<Snapshot> {
  const [health, readiness] = await Promise.all([
    fetchJson('/api/v1/health')
      .then((json) => healthBody.parse(json).data)
      .catch(() => null),
    fetchJson('/api/v1/ready')
      .then((json) => readinessBody.parse(json).data)
      .catch(() => null),
  ]);
  return { health, readiness, checkedAt: new Date() };
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function SystemStatus() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      loadSnapshot().then((next) => {
        if (active) setSnapshot(next);
      });
    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (!snapshot) {
    return <p className="muted">Checking the API…</p>;
  }

  const apiUp = snapshot.health !== null;
  const databaseUp = snapshot.readiness?.checks.database === 'up';

  return (
    <section className="status" aria-live="polite">
      <dl className="checks">
        <div className="check">
          <dt>API</dt>
          <dd>
            <span className={apiUp ? 'pill ok' : 'pill down'}>{apiUp ? 'Online' : 'Offline'}</span>
          </dd>
        </div>
        <div className="check">
          <dt>Database</dt>
          <dd>
            <span className={databaseUp ? 'pill ok' : 'pill down'}>
              {snapshot.readiness ? (databaseUp ? 'Connected' : 'Unreachable') : 'Unknown'}
            </span>
          </dd>
        </div>
        <div className="check">
          <dt>Version</dt>
          <dd className="mono">{snapshot.health?.version ?? '—'}</dd>
        </div>
        <div className="check">
          <dt>Uptime</dt>
          <dd className="mono">
            {snapshot.health ? formatUptime(snapshot.health.uptimeSeconds) : '—'}
          </dd>
        </div>
      </dl>
      <p className="muted">
        {`Last checked ${snapshot.checkedAt.toLocaleTimeString()} · refreshes every ${REFRESH_MS / 1000}s`}
      </p>
    </section>
  );
}
