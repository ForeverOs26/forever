/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the recovery contract.
 *
 * Pure constants and closed vocabularies, free of DOM, storage, network,
 * router, React and Supabase imports so every rule can be tested directly.
 *
 * THE MARKER. One `sessionStorage` entry records that this tab has already
 * spent its single automatic reload for one specific version transition. It is
 * DENY-ONLY in exactly the sense the recovery guard already uses elsewhere in
 * this repository: its only power is to REFUSE a second automatic reload. A
 * forged or corrupted marker costs the visitor one manual reload button and
 * nothing else — it can never cause a reload, never grant access, never
 * resubmit anything.
 *
 * WHAT THE MARKER MAY CONTAIN — and this list is exhaustive:
 *   - a fixed schema version;
 *   - the public build identifier the page was running;
 *   - the public build identifier the origin reported;
 *   - the attempt count, which is always exactly 1;
 *   - a bounded millisecond timestamp, used only to expire an abandoned marker.
 *
 * WHAT IT MUST NEVER CONTAIN. A token, an access or refresh token, an email, a
 * user id, a job id, a filename, an object key, an asset URL, a query string, a
 * stack trace, an error message, a route, or any private route data. The
 * validator below refuses any object carrying an unknown key, so this is
 * enforced rather than merely intended.
 */

/** Bounded shape of a public build identifier. Shared by the browser and the build. */
export const FOREVER_BUILD_ID_PATTERN = /^[a-z0-9]{1,32}$/;

/** sessionStorage key for the deny-only one-attempt marker. */
export const STALE_ASSET_RECOVERY_MARKER_KEY = "forever.app.stale-asset.recovery";

/** Marker schema version. Any other value is treated as absent. */
export const STALE_ASSET_RECOVERY_MARKER_SCHEMA = 1;

/** Exactly one automatic reload is ever permitted per version transition. */
export const STALE_ASSET_RECOVERY_MAX_ATTEMPTS = 1;

/**
 * How long a marker stays meaningful.
 *
 * A tab left open across several releases must not be permanently barred from
 * recovering, and a marker whose transition is long finished is just noise. The
 * transition identity (from → to) is the primary scope; this is the backstop.
 */
export const STALE_ASSET_RECOVERY_MARKER_TTL_MS = 12 * 60 * 60 * 1000;

/** Every state the recovery machine can be in. Nothing outside this list exists. */
export const STALE_ASSET_RECOVERY_STATES = ["idle", "recovering", "recovery_required"] as const;

export type StaleAssetRecoveryState = (typeof STALE_ASSET_RECOVERY_STATES)[number];

/**
 * Every outcome one recovery decision can produce. Closed so a caller cannot
 * invent a fourth behaviour, and so the tests can enumerate the whole surface.
 */
export const STALE_ASSET_RECOVERY_OUTCOMES = [
  /** Not a stale versioned asset. Nothing happens; the ordinary error path runs. */
  "not_stale",
  /** Confirmed stale, safe, and the origin really is on a different build. One reload issued. */
  "reload_issued",
  /** Confirmed stale, but this tab already spent its one reload for this transition. */
  "attempt_already_used",
  /**
   * Confirmed stale, but a decision for an earlier signal is still running or
   * has already issued the reload. One failure reaches the page on more than
   * one channel — `vite:preloadError` and the modulepreload element's own
   * `error` both fire for the same missing chunk — and each must not become its
   * own decision, its own build probe and its own reload.
   */
  "already_handling",
  /** Confirmed stale, but the origin reports the SAME build. A reload would prove nothing. */
  "same_build",
  /** Confirmed stale, but the active build could not be read. Refuse rather than guess. */
  "active_build_unknown",
  /** Confirmed stale, but a consequential action's outcome is unproven. Never reload. */
  "write_in_flight",
  /** Confirmed stale on a route where an automatic reload is never permitted. */
  "route_denied",
  /** No storage to record the attempt in, so a second reload could not be prevented. */
  "storage_unavailable",
] as const;

export type StaleAssetRecoveryOutcome = (typeof STALE_ASSET_RECOVERY_OUTCOMES)[number];

/**
 * Routes where an automatic reload is NEVER permitted, whatever the evidence.
 *
 * `/studio/reset-password` is the only entry: it is the one place in this
 * application that carries an authentication fragment in the URL, and reloading
 * it would re-enter a password-recovery flow the visitor did not ask to repeat.
 * The existing recovery guard already treats that path as special
 * (`studio-recovery-contract.ts`); this keeps the two consistent.
 */
export const STALE_ASSET_RECOVERY_DENIED_ROUTES = ["/studio/reset-password"] as const;

export function routeForbidsAutomaticRecovery(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return STALE_ASSET_RECOVERY_DENIED_ROUTES.some(
    (denied) => path === denied || path.startsWith(`${denied}/`),
  );
}

/**
 * Routes whose recovery is only proved by the Studio shell mounting.
 *
 * A recovered Studio page is not "usable" because React rendered something —
 * it is usable when the authenticated shell and its dashboard chunk graph have
 * actually loaded. Clearing the marker before that would hand the next failure
 * a fresh attempt it has not earned, which is how a reload loop starts.
 */
export const STALE_ASSET_STUDIO_ROUTE_PREFIX = "/studio";

export function routeRequiresStudioShellProof(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return (
    path === STALE_ASSET_STUDIO_ROUTE_PREFIX ||
    path.startsWith(`${STALE_ASSET_STUDIO_ROUTE_PREFIX}/`)
  );
}

/** What proved the intended route graph finished loading. Closed. */
export type StaleAssetLoadProof = "router_resolved" | "studio_shell_mounted";

export type StaleAssetRecoveryMarker = {
  v: typeof STALE_ASSET_RECOVERY_MARKER_SCHEMA;
  from: string;
  to: string;
  attempt: number;
  at: number;
};

/** The complete set of keys a marker may carry. An extra key invalidates it. */
const MARKER_KEYS = ["v", "from", "to", "attempt", "at"] as const;

/**
 * Strict validation. Anything unexpected — a wrong schema, an unbounded
 * identifier, an attempt count above the ceiling, a stray key, a future
 * timestamp — makes the marker invalid, and an invalid marker is treated as
 * absent (and deleted). Failing this way is safe: the worst case is that a tab
 * is allowed one automatic reload it might otherwise have been refused, which
 * is still bounded at one.
 */
export function parseStaleAssetRecoveryMarker(
  raw: unknown,
  now: number,
  ttlMs: number = STALE_ASSET_RECOVERY_MARKER_TTL_MS,
): StaleAssetRecoveryMarker | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 256) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const candidate = parsed as Record<string, unknown>;
  for (const key of Object.keys(candidate)) {
    if (!(MARKER_KEYS as readonly string[]).includes(key)) return null;
  }
  if (candidate.v !== STALE_ASSET_RECOVERY_MARKER_SCHEMA) return null;
  const { from, to, attempt, at } = candidate;
  if (typeof from !== "string" || !FOREVER_BUILD_ID_PATTERN.test(from)) return null;
  if (typeof to !== "string" || !FOREVER_BUILD_ID_PATTERN.test(to)) return null;
  if (typeof attempt !== "number" || !Number.isInteger(attempt)) return null;
  if (attempt < 1 || attempt > STALE_ASSET_RECOVERY_MAX_ATTEMPTS) return null;
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return null;
  if (at > now + 60_000) return null;
  if (now - at > ttlMs) return null;

  return { v: STALE_ASSET_RECOVERY_MARKER_SCHEMA, from, to, attempt, at };
}

export function serializeStaleAssetRecoveryMarker(marker: StaleAssetRecoveryMarker): string {
  // Key order is fixed so the serialized form is stable and reviewable.
  return JSON.stringify({
    v: marker.v,
    from: marker.from,
    to: marker.to,
    attempt: marker.attempt,
    at: marker.at,
  });
}

/**
 * True when the marker bars a second automatic reload for THIS transition.
 *
 * Scoped to the exact `from → to` pair. A later, genuinely different release
 * gets its own attempt; the same one never gets a second.
 */
export function markerBlocksTransition(
  marker: StaleAssetRecoveryMarker | null,
  from: string,
  to: string,
): boolean {
  if (!marker) return false;
  if (marker.from !== from) return false;
  if (marker.to !== to) return false;
  return marker.attempt >= STALE_ASSET_RECOVERY_MAX_ATTEMPTS;
}

/**
 * The route and query the recovered page must come back to.
 *
 * The fragment is deliberately DROPPED. It is the only part of a URL this
 * application ever uses to carry authentication material (the Supabase recovery
 * link), and replaying a fragment automatically is exactly the thing the
 * password-recovery guard exists to prevent. Path and query — the parts that
 * describe which page the visitor was on — are preserved exactly.
 */
export function safeRecoveryTarget(pathname: string, search: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (!search || search === "?") return path;
  return `${path}${search.startsWith("?") ? search : `?${search}`}`;
}
