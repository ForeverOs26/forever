/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the browser half of CLIENT ASSET
 * identity.
 *
 * `FOREVER_CLIENT_ASSET_ID` is inlined by the bundler into this build's client
 * AND server output (see `scripts/build/forever-client-asset-id.ts` and the
 * `define` in vite.config.ts). The page therefore knows, with no network call
 * and before any authenticated Studio work, which client asset graph it is
 * running.
 *
 * `fetchActiveClientAssetId` asks the origin which client asset graph it is
 * serving NOW. That one comparison is what separates "this origin moved on
 * without me and my chunks are gone" from "an ordinary error happened", and it
 * is the reason a reload is ever permitted.
 *
 * IT IS NOT A RELEASE IDENTITY (narrow-re-review RR2-P1-1). A server-only
 * release ships the same value, correctly, because no chunk this page holds can
 * 404. Which Worker is deployed is a different question with a different
 * answer: the immutable Cloudflare Worker version UUID, which is never inlined
 * here, never served here and never compared here. See
 * `worker-release-identity.ts`.
 *
 * SAFETY. The request is same-origin, `no-store`, credential-free and bounded:
 * it sends nothing, it accepts only a `{ "clientAssetId": "<bounded id>" }`
 * object, and every other outcome — a network failure, a timeout, an HTML page,
 * a malformed body, an out-of-shape identifier — resolves to `null`, which the
 * caller must treat as "cannot prove a client asset change" and therefore as
 * "do not reload".
 */

import { FOREVER_CLIENT_ASSET_ID_PATTERN } from "./client-asset-id-contract";

declare const __FOREVER_CLIENT_ASSET_ID__: string | undefined;

/** The client asset graph this page is running. Compile-time constant. */
export const FOREVER_CLIENT_ASSET_ID: string =
  typeof __FOREVER_CLIENT_ASSET_ID__ === "string" && __FOREVER_CLIENT_ASSET_ID__.length > 0
    ? __FOREVER_CLIENT_ASSET_ID__
    : "development";

/**
 * Same-origin path that reports the ACTIVE client asset identity.
 *
 * Named for what it reports. The previous `/forever-build.json` invited the
 * reading that it answered "which build is deployed", which is the conflation
 * RR2-P1-1 recorded. Never carries a parameter.
 */
export const FOREVER_CLIENT_ASSETS_ENDPOINT = "/forever-client-assets.json";

/** How long to wait before giving up and refusing to reload. */
export const FOREVER_CLIENT_ASSETS_PROBE_TIMEOUT_MS = 4000;

export function isBoundedClientAssetId(value: unknown): value is string {
  return typeof value === "string" && FOREVER_CLIENT_ASSET_ID_PATTERN.test(value);
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Reads the active client asset identifier, or `null` when it cannot be proved.
 *
 * Never throws and never retries: a recovery decision that hangs is a page that
 * hangs, and a retry loop against an origin mid-release is exactly the traffic
 * a release does not need.
 */
export async function fetchActiveClientAssetId(
  options: {
    fetchImpl?: FetchLike;
    endpoint?: string;
    timeoutMs?: number;
  } = {},
): Promise<string | null> {
  const endpoint = options.endpoint ?? FOREVER_CLIENT_ASSETS_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? FOREVER_CLIENT_ASSETS_PROBE_TIMEOUT_MS;
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
      // cache would report the client assets this page already knows about.
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null) return null;
    const clientAssetId = (payload as { clientAssetId?: unknown }).clientAssetId;
    return isBoundedClientAssetId(clientAssetId) ? clientAssetId : null;
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
