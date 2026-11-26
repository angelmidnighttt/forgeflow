/**
 * Where to go after signing in, from `?next=`. Only paths on this site are accepted: anything
 * else (another origin, `//evil.example`, `/\evil.example`, a `javascript:` URL) would turn the
 * login page into an open redirect, so it falls back to `fallback`.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback;
  }
  try {
    const url = new URL(next, 'http://forgeflow.invalid');
    if (url.origin !== 'http://forgeflow.invalid') return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** `/login?next=<path>` for sending a signed-out visitor to the login page and back. */
export function loginPathFor(currentPath: string): string {
  return currentPath === '/' ? '/login' : `/login?next=${encodeURIComponent(currentPath)}`;
}
