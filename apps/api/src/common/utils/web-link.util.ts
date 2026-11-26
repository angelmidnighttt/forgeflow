/**
 * A link to a page of the web app. A secret goes after `#`: browsers never send the fragment to
 * a server or put it in the Referer header, so the token stays out of access logs and analytics.
 */
export function webLink(appOrigin: string, path: string, secret?: string): string {
  const url = new URL(path, appOrigin);
  if (secret !== undefined) url.hash = `token=${secret}`;
  return url.toString();
}
