import { healthSchema, readinessSchema, type Health, type Readiness } from '@forgeflow/contracts';
import { getData } from '@/lib/api-client';

export interface SystemStatusSnapshot {
  health: Health | null;
  readiness: Readiness | null;
  checkedAt: Date;
}

/** Health and readiness of the API. A check that cannot be reached comes back as null. */
export async function loadSystemStatus(): Promise<SystemStatusSnapshot> {
  const [health, readiness] = await Promise.all([
    getData('/api/v1/health', healthSchema).catch(() => null),
    getData('/api/v1/ready', readinessSchema).catch(() => null),
  ]);
  return { health, readiness, checkedAt: new Date() };
}

export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}
