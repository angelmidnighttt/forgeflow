import type { Environment } from '@forgeflow/contracts';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/** A project's environments in order; protected ones carry a shield. */
export function EnvironmentBadges({ environments }: { environments: Environment[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {environments.map((environment) => (
        <Badge
          key={environment.id}
          variant={environment.protected ? 'secondary' : 'outline'}
          title={environment.protected ? 'Được bảo vệ: thay đổi cần duyệt' : undefined}
        >
          {environment.protected ? <ShieldCheck aria-label="Được bảo vệ" /> : null}
          {environment.name}
        </Badge>
      ))}
    </div>
  );
}
