'use client';

import type { OrganizationRole } from '@forgeflow/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../roles';

/** Picks a role among `roles` (the ones the current user may give). */
export function RoleSelect({
  id,
  value,
  roles,
  onChange,
  disabled,
  describe = false,
  'aria-label': ariaLabel,
}: {
  id?: string;
  value: OrganizationRole;
  roles: OrganizationRole[];
  onChange: (role: OrganizationRole) => void;
  disabled?: boolean;
  /** Show what each role may do under its name. */
  describe?: boolean;
  'aria-label'?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as OrganizationRole)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className="min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role} value={role}>
            {describe ? (
              <span className="flex flex-col">
                <span>{ROLE_LABELS[role]}</span>
                <span className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</span>
              </span>
            ) : (
              ROLE_LABELS[role]
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
