'use client';

import type { Organization } from '@forgeflow/contracts';
import { useParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/features/auth/auth-provider';
import { errorMessage } from '@/features/auth/messages';
import { organizationsApi } from './organizations-api';

export type OrganizationsState =
  | { status: 'loading' }
  | { status: 'ready'; organizations: Organization[] }
  | { status: 'error'; message: string };

interface OrganizationsContextValue {
  state: OrganizationsState;
  /** Loads the list again (after creating, renaming, leaving…); resolves with the new list. */
  reload(): Promise<Organization[]>;
}

const OrganizationsContext = createContext<OrganizationsContextValue | null>(null);

/** The signed-in user's organizations, with their role in each. Lives inside <RequireAuth>. */
export function OrganizationsProvider({ children }: { children: ReactNode }) {
  const { withAccessToken } = useAuth();
  const [state, setState] = useState<OrganizationsState>({ status: 'loading' });

  const reload = useCallback(async () => {
    try {
      const organizations = await withAccessToken((token) => organizationsApi.list(token));
      setState({ status: 'ready', organizations });
      return organizations;
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
      return [];
    }
  }, [withAccessToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo(() => ({ state, reload }), [state, reload]);
  return <OrganizationsContext.Provider value={value}>{children}</OrganizationsContext.Provider>;
}

export function useOrganizations(): OrganizationsContextValue {
  const context = useContext(OrganizationsContext);
  if (!context) throw new Error('useOrganizations must be used inside <OrganizationsProvider>');
  return context;
}

/** The organization of the current /orgs/[orgId] route, or undefined elsewhere. */
export function useRouteOrganization(): Organization | undefined {
  const { orgId } = useParams<{ orgId?: string }>();
  const { state } = useOrganizations();
  if (!orgId || state.status !== 'ready') return undefined;
  return state.organizations.find((organization) => organization.id === orgId);
}
