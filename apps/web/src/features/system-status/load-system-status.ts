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

/** "2 giờ 5 phút", "3 phút 12 giây", "40 giây". */
export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h} giờ ${m} phút`;
  return m > 0 ? `${m} phút ${s} giây` : `${s} giây`;
}
