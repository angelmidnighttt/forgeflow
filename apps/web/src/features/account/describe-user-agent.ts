/**
 * "Chrome trên Windows" from a User-Agent header, for the list of signed-in devices. A rough
 * guess on purpose: the raw header stays available as a tooltip.
 */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Thiết bị không rõ';
  // Order matters: Edge and Opera also claim Chrome, Chrome also claims Safari, iOS claims macOS,
  // Android claims Linux.
  const browser = /Edg(e|A|iOS)?\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\/|FxiOS\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : null;
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(userAgent)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  if (browser && os) return `${browser} trên ${os}`;
  return browser ?? os ?? (userAgent.length > 40 ? `${userAgent.slice(0, 40)}…` : userAgent);
}
