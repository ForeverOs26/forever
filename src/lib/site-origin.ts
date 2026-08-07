/**
 * The ONE origin Forever declares itself to be served from, and the exact
 * comparison every origin guard uses.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Two different places used to spell out the same production origin as a
 * literal: the sitemap/canonical-URL constant and the media-serving default.
 * That was harmless while the answer was only ever printed into a URL. It
 * stopped being harmless when the answer also had to decide whether a request
 * is ALLOWED to start a private upload (Issue #103), so the value and the
 * comparison live here, once, and both of those now derive from this rather
 * than re-declaring it. Media keeps its own precedence chain — it may
 * legitimately be served from elsewhere — but not its own literal.
 *
 * `normalizeOrigin` is deliberately strict and deliberately dumb. It performs
 * no suffix, substring, prefix or wildcard matching of any kind, and it never
 * "repairs" an input into something plausible: an origin is a scheme, a host
 * and an explicit port when one applies — nothing else — and anything that is
 * not exactly that returns `null`, which can never match.
 *
 * This module is client-safe on purpose: it imports nothing, reaches no server
 * module, and holds no credential, endpoint, bucket or path.
 */

/**
 * The live public origin, used when no build/deployment configuration says
 * otherwise.
 *
 * It must never name the superseded Lovable project host the site was first
 * built on — `sitemap.test.ts` fails the build if any origin, sitemap or robots
 * output mentions that hostname again (F-019).
 */
export const DEFAULT_PUBLIC_SITE_ORIGIN = "https://forever.phuketre22.workers.dev";

/**
 * Absolute origin this BUILD believes the public site is served from.
 *
 * Canonical URLs, Open Graph URLs, breadcrumb structured data, the sitemap and
 * the Studio upload guard must all state the origin the build is actually
 * deployed to, so this is configuration rather than a constant: set
 * `VITE_PUBLIC_SITE_ORIGIN` for the production build. It is a public
 * identifier, never a credential, so inlining it into the client bundle is
 * intended.
 */
export const PUBLIC_SITE_ORIGIN = (
  import.meta.env.VITE_PUBLIC_SITE_ORIGIN ?? DEFAULT_PUBLIC_SITE_ORIGIN
).replace(/\/+$/, "");

/**
 * A real host: dot-separated DNS labels, or an IPv4 literal.
 *
 * `URL` is far more permissive than this — it happily parses `https://*` and
 * `https://*.workers.dev` and hands back `*` as the hostname. A pattern is not
 * a host, and a configuration that contains one has asked for something this
 * guard does not do, so it is refused outright rather than compared literally
 * and quietly never matched. An IPv6 literal is refused for the same reason:
 * nothing here is served from one, and an unrecognised host shape must fail
 * closed rather than be guessed at.
 */
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * The canonical form of one origin, or `null` when the value is not an origin.
 *
 * Accepted: `http`/`https`, a real host, an optional explicit port, and at most
 * a single trailing `/` (which a configured value often carries and which
 * cannot smuggle a different origin). The returned value is `URL.origin`, so
 * the scheme and host are lower-cased and a port that equals the scheme default
 * is dropped — the comparison RFC 6454 defines.
 *
 * Refused — every one of these returns `null` rather than a best guess:
 *   - a missing, empty or non-string value;
 *   - the literal `null` an opaque (sandboxed) origin sends;
 *   - a scheme other than http/https, so `data:`, `file:` and `blob:` never match;
 *   - a host that is a pattern rather than a host (see `HOSTNAME`);
 *   - embedded credentials, which is how `https://trusted.example@evil.test`
 *     tries to read as the trusted host;
 *   - any path, query or fragment, which is how `https://evil.test/#https://trusted.example`
 *     tries the same thing;
 *   - anything `URL` cannot parse, including the comma-joined value a duplicated
 *     `Origin` header produces.
 */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null") return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.search !== "" || url.hash !== "") return null;
  if (url.pathname !== "" && url.pathname !== "/") return null;
  if (!HOSTNAME.test(url.hostname)) return null;
  return url.origin;
}

/**
 * Whether two values name the SAME origin.
 *
 * Exact equality of the canonical forms: scheme, hostname and explicit port all
 * have to agree. A value that is not an origin never matches anything,
 * including another unparseable value — two unknowns are not a match.
 */
export function originsMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normalizeOrigin(left);
  const b = normalizeOrigin(right);
  return a !== null && b !== null && a === b;
}
