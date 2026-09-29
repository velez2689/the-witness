/**
 * Decides whether a request to a server route came from this site's own pages in a browser.
 *
 * The token route hands out short-lived AssemblyAI credentials, so a plain command-line request
 * (no Origin, no Sec-Fetch-Site) must not get one. Browsers always send `Sec-Fetch-Site` on a
 * fetch; when it is present it is the answer: only `same-origin` passes, and `none` (a typed URL)
 * or `cross-site` do not. When it is absent (an older browser) the Origin header must name this
 * host. A request with neither is refused.
 *
 * This raises the cost of casual abuse of the public demo URL. It is not authentication: a
 * determined client can set headers, which is why the route also rate-limits and caps sessions.
 */
export function isSameOriginRequest(headers: { get(name: string): string | null }): boolean {
  const site = headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';

  const origin = headers.get('origin');
  const host = headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
