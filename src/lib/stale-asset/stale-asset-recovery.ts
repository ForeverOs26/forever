/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the bounded recovery machine.
 *
 * ONE automatic reload, for ONE proven version transition, in ONE tab, and only
 * when nothing consequential is in flight. Every other path refuses and hands
 * the visitor a specific, honest screen with a manual reload button.
 *
 * ORDER OF THE DECISION — each step can only ever REFUSE:
 *   1. the failure must classify as a stale versioned asset;
 *   2. the current route must permit an automatic reload at all;
 *   3. no consequential action may be unproven in this page;
 *   4. `sessionStorage` must be writable, or a second reload could not be
 *      prevented and therefore a first one must not happen;
 *   5. the origin must report a build identifier, and it must DIFFER from the
 *      one this page is running;
 *   6. this tab must not already have spent its attempt on that exact
 *      transition.
 *
 * Only after all six does the marker get written — before the reload, never
 * after, so a reload that begins is already accounted for.
 *
 * SUCCESS IS NOT "REACT MOUNTED". The marker is cleared only when the intended
 * route graph has actually loaded: for Studio, when the authenticated shell has
 * mounted. Clearing it at root mount would hand the next failure a fresh
 * attempt it has not earned, which is precisely how a reload loop starts.
 */

import {
  classifyStaleAssetError,
  type StaleAssetSignal,
  type StaleAssetVerdict,
  verdictIsStale,
} from "./stale-asset-contract";
import { FOREVER_BUILD_ID, fetchActiveBuildId } from "./build-identity";
import {
  markerBlocksTransition,
  parseStaleAssetRecoveryMarker,
  routeForbidsAutomaticRecovery,
  routeRequiresStudioShellProof,
  safeRecoveryTarget,
  serializeStaleAssetRecoveryMarker,
  STALE_ASSET_RECOVERY_MARKER_KEY,
  STALE_ASSET_RECOVERY_MARKER_SCHEMA,
  type StaleAssetLoadProof,
  type StaleAssetRecoveryMarker,
  type StaleAssetRecoveryOutcome,
  type StaleAssetRecoveryState,
} from "./stale-asset-recovery-contract";
import { hasUnprovenConsequentialAction } from "./write-safety";

// ---------------------------------------------------------------------------
// Observable state — the root component renders from this and nothing else
// ---------------------------------------------------------------------------

type Listener = () => void;

const listeners = new Set<Listener>();
let state: StaleAssetRecoveryState = "idle";

/**
 * True from the moment a stale decision starts until the page is replaced.
 *
 * One missing chunk surfaces on several channels at once — the preload event
 * and the `<link rel="modulepreload">` element's own error, at minimum — and
 * without this each would run its own decision and its own build probe.
 * Measured in a real browser: two channels, two probes, for a single failure.
 */
let decisionInFlight = false;

function setState(next: StaleAssetRecoveryState): void {
  if (state === next) return;
  state = next;
  for (const listener of listeners) listener();
}

export function getStaleAssetRecoveryState(): StaleAssetRecoveryState {
  return state;
}

export function subscribeStaleAssetRecoveryState(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only reset of the in-memory half. Never called by application code. */
export function resetStaleAssetRecoveryStateForTest(): void {
  state = "idle";
  decisionInFlight = false;
  listeners.clear();
}

// ---------------------------------------------------------------------------
// Marker storage
// ---------------------------------------------------------------------------

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function resolveStorage(supplied?: StorageLike | null): StorageLike | null {
  // `undefined` means "not supplied — use the ambient store". An explicit
  // `null` means "there is no store", and must NOT silently fall back to one:
  // the caller is stating the condition under which a second reload could not
  // be prevented, which is a refusal, not a default.
  if (supplied !== undefined) return supplied;
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    // Storage disabled or partitioned. Not an error — a refusal.
    return null;
  }
}

export function readRecoveryMarker(
  now: number,
  storage?: StorageLike | null,
): StaleAssetRecoveryMarker | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(STALE_ASSET_RECOVERY_MARKER_KEY);
  } catch {
    return null;
  }
  const marker = parseStaleAssetRecoveryMarker(raw, now);
  if (!marker && raw !== null) {
    // An unreadable marker is deleted rather than left to be re-parsed for ever.
    try {
      store.removeItem(STALE_ASSET_RECOVERY_MARKER_KEY);
    } catch {
      /* nothing further to do */
    }
  }
  return marker;
}

function writeRecoveryMarker(
  marker: StaleAssetRecoveryMarker,
  storage?: StorageLike | null,
): boolean {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.setItem(STALE_ASSET_RECOVERY_MARKER_KEY, serializeStaleAssetRecoveryMarker(marker));
    return true;
  } catch {
    return false;
  }
}

export function clearRecoveryMarker(storage?: StorageLike | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(STALE_ASSET_RECOVERY_MARKER_KEY);
  } catch {
    /* nothing further to do */
  }
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export type StaleAssetRecoveryEnvironment = {
  origin: string;
  pathname: string;
  search: string;
  /** Replaces the current document. Injected so the decision is testable. */
  reload: (target: string) => void;
  now?: () => number;
  storage?: StorageLike | null;
  ownBuildId?: string;
  readActiveBuildId?: () => Promise<string | null>;
  hasUnprovenWrite?: () => boolean;
};

export type StaleAssetRecoveryDecision = {
  verdict: StaleAssetVerdict;
  outcome: StaleAssetRecoveryOutcome;
};

/**
 * Classifies one failure and, at most once, recovers from it.
 *
 * Returns a closed verdict/outcome pair and nothing else — no message, no URL,
 * no stack, nothing that could carry an identifier out of this module.
 */
export async function handleStaleAssetSignal(
  signal: StaleAssetSignal,
  environment: StaleAssetRecoveryEnvironment,
): Promise<StaleAssetRecoveryDecision> {
  const verdict = classifyStaleAssetError(signal, { origin: environment.origin });
  if (!verdictIsStale(verdict)) return { verdict, outcome: "not_stale" };

  // A second channel reporting the SAME failure must not become a second
  // decision, a second build probe or a second reload.
  if (decisionInFlight) return { verdict, outcome: "already_handling" };
  decisionInFlight = true;

  const refuse = (outcome: StaleAssetRecoveryOutcome): StaleAssetRecoveryDecision => {
    // Every refusal is still a CONFIRMED version problem, so the visitor gets
    // the specific screen rather than the generic failure. The gate is released
    // because no reload is happening — a later, genuinely different transition
    // must still be able to decide.
    decisionInFlight = false;
    setState("recovery_required");
    return { verdict, outcome };
  };

  if (routeForbidsAutomaticRecovery(environment.pathname)) return refuse("route_denied");

  const hasWrite = environment.hasUnprovenWrite ?? hasUnprovenConsequentialAction;
  if (hasWrite()) return refuse("write_in_flight");

  const now = (environment.now ?? Date.now)();
  const storage = resolveStorage(environment.storage);
  if (!storage) return refuse("storage_unavailable");

  const ownBuildId = environment.ownBuildId ?? FOREVER_BUILD_ID;
  const readActive = environment.readActiveBuildId ?? (() => fetchActiveBuildId());
  const activeBuildId = await readActive();
  if (activeBuildId === null) return refuse("active_build_unknown");
  if (activeBuildId === ownBuildId) return refuse("same_build");

  const existing = readRecoveryMarker(now, storage);
  if (markerBlocksTransition(existing, ownBuildId, activeBuildId)) {
    return refuse("attempt_already_used");
  }

  const wrote = writeRecoveryMarker(
    {
      v: STALE_ASSET_RECOVERY_MARKER_SCHEMA,
      from: ownBuildId,
      to: activeBuildId,
      attempt: 1,
      at: now,
    },
    storage,
  );
  // The marker is the ONLY thing preventing a second reload. If it could not be
  // written, the reload does not happen.
  if (!wrote) return refuse("storage_unavailable");

  // `decisionInFlight` deliberately stays set: the page is being replaced, and
  // any further signal arriving before it unloads must not start another
  // decision.
  setState("recovering");
  environment.reload(safeRecoveryTarget(environment.pathname, environment.search));
  return { verdict, outcome: "reload_issued" };
}

// ---------------------------------------------------------------------------
// Success — the only thing allowed to clear the marker
// ---------------------------------------------------------------------------

/**
 * Records that a route graph finished loading, and clears the marker when that
 * is genuine proof the recovered route is usable.
 *
 * A Studio route is proved ONLY by the authenticated shell mounting; the
 * router merely resolving is not enough there, because the shell and its
 * dashboard chunk graph are exactly what failed to load. Every other route is
 * proved by the router resolving it.
 *
 * The root component mounting proves nothing anywhere and is never a caller.
 */
export function noteStaleAssetRouteGraphLoaded(
  input: { pathname: string; proof: StaleAssetLoadProof },
  storage?: StorageLike | null,
): boolean {
  const needsShell = routeRequiresStudioShellProof(input.pathname);
  if (needsShell && input.proof !== "studio_shell_mounted") return false;
  clearRecoveryMarker(storage);
  setState("idle");
  return true;
}

/**
 * Puts the page into the bounded recovery screen without reloading.
 *
 * Used by the root error boundary when a confirmed stale failure reaches it on
 * a path the capture layer did not own.
 */
export function requireManualStaleAssetRecovery(): void {
  setState("recovery_required");
}
