'use client';

import { useEffect, useState } from 'react';
import { formatUptime, loadSystemStatus, type SystemStatusSnapshot } from './load-system-status';

const REFRESH_MS = 10_000;

export function SystemStatus() {
  const [snapshot, setSnapshot] = useState<SystemStatusSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      loadSystemStatus().then((next) => {
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
