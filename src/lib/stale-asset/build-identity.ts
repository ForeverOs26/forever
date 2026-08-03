/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the browser half of build identity.
 *
 * `FOREVER_BUILD_ID` is inlined by the bundler into this build's client AND
 * server output (see `scripts/build/forever-build-id.ts` and the `define` in
 * vite.config.ts). The page therefore knows, with no network call and before any
 * authenticated Studio work, which build it is running.
 *
 * `fetchActiveBuildId` asks the origin which build it is serving NOW. That one
 * comparison is what separates "this deployment moved on without me" from "an
 * ordinary error happened", and it is the reason a reload is ever permitted.
 *
 * SAFETY. The request is same-origin, `no-store`, credential-free and bounded:
 * it sends nothing, it accepts only a `{ "build": "<bounded id>" }` object, and
 * every other outcome — a network failure, a timeout, an HTML page, a malformed
 * body, an out-of-shape identifier — resolves to `null`, which the caller must
 * treat as "cannot prove a version change" and therefore as "do not reload".
 */

import { FOREVER_BUILD_ID_PATTERN } from "./stale-asset-recovery-contract";

declare const __FOREVER_BUILD_ID__: string | undefined;

/** The build this page is running. Compile-time constant; never fetched. */
export const FOREVER_BUILD_ID: string =
  typeof __FOREVER_BUILD_ID__ === "string" && __FOREVER_BUILD_ID__.length > 0
    ? __FOREVER_BUILD_ID__
    : "development";

/** Same-origin path that reports the ACTIVE build. Never carries a parameter. */
export const FOREVER_BUILD_ENDPOINT = "/forever-build.json";

/** How long to wait before giving up and refusing to reload. */
export const FOREVER_BUILD_PROBE_TIMEOUT_MS = 4000;

export function isBoundedBuildId(value: unknown): value is string {
  return typeof value === "string" && FOREVER_BUILD_ID_PATTERN.test(value);
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Reads the active build identifier, or `null` when it cannot be proved.
 *
 * Never throws and never retries: a recovery decision that hangs is a page that
 * hangs, and a retry loop against an origin mid-release is exactly the traffic
 * a release does not need.
 */
export async function fetchActiveBuildId(
  options: {
    fetchImpl?: FetchLike;
    endpoint?: string;
    timeoutMs?: number;
  } = {},
): Promise<string | null> {
  const endpoint = options.endpoint ?? FOREVER_BUILD_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? FOREVER_BUILD_PROBE_TIMEOUT_MS;
  const fetchImpl =
    options.fetchImpl ??
    (typeof globalThis.fetch === "function"
      ? (globalThis.fetch.bind(globalThis) as FetchLike)
      : null);
  if (!fetchImpl) return null;

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(endpoint, {
      // The whole point is to bypass every cache: an identifier read from the
      // cache would report the build this page already knows about.
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null) return null;
    const build = (payload as { build?: unknown }).build;
    return isBoundedBuildId(build) ? build : null;
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
