const KEY = 'forgeflow:last-organization';

/** The organization the user opened last on this browser, to open it again from "/". */
export function readLastOrganization(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberLastOrganization(orgId: string): void {
  try {
    window.localStorage.setItem(KEY, orgId);
  } catch {
    // Storage can be unavailable (private mode, quota); remembering is only a convenience.
  }
}

/** Which organization to open: the last one if the user still belongs to it, else the first. */
export function pickOrganization(ids: string[], last: string | null): string | undefined {
  return last && ids.includes(last) ? last : ids[0];
}
