/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the bounded recovery machine.
 *
 * A BOUNDED number of automatic reloads per tab, at most ONE per ordered
 * version transition, and only when nothing consequential is in flight. Every
 * other path refuses and hands the visitor a specific, honest screen with a
 * manual reload button.
 *
 * ORDER OF THE DECISION — each step can only ever REFUSE:
 *   1. the failure must classify as a stale versioned asset;
 *   2. the current route must permit an automatic reload at all;
 *   3. no consequential action may be unproven in this page;
 *   4. `sessionStorage` must be readable and writable, or a further reload
 *      could not be prevented and therefore this one must not happen;
 *   5. whatever storage holds must be a VALID ledger; a malformed one refuses;
 *   6. the origin must report a build identifier, and it must DIFFER from the
 *      one this page is running;
 *   7. the ledger must not already have spent an attempt on that exact
 *      transition, and the tab must not have spent its whole budget.
 *
 * Only after all seven is the attempt recorded — before the reload, never
 * after, and into BOTH the pending slot and the bounded history in one write,
 * so a reload that begins is already accounted for even if the page never
 * comes back.
 *
 * SUCCESS IS NOT "REACT MOUNTED", AND IT IS NOT "A ROUTE RESOLVED"
 * (independent-review P1-2). The reviewed design cleared its marker whenever
 * any non-Studio route resolved, so the recovery screen's own "Go to site"
 * control cleared the guard and re-armed the identical broken transition. Here
 * the only thing that clears anything is an explicit exact-route attestation
 * that proves the recovered build, the recovered route kind, the leaf module,
 * its nested modules, the absence of an error boundary, authenticated Studio
 * readiness where applicable, and a quiet stabilization window. And even then
 * it clears ONLY the pending recovery. The attempted-transition history is
 * never erased by navigation, by Back, by a redirect or by success.
 */

import {
  classifyStaleAssetError,
  type StaleAssetSignal,
  type StaleAssetVerdict,
  verdictIsStale,
} from "./stale-asset-contract";
import { FOREVER_CLIENT_ASSET_ID, fetchActiveClientAssetId } from "./client-asset-identity";
import {
  attestationClearsPending,
  clearPendingRecovery,
  emptyLedger,
  ledgerBlocksTransition,
  parseStaleAssetRecoveryLedger,
  recordStaleAssetAttempt,
  routeForbidsAutomaticRecovery,
  routeKindOf,
  safeRecoveryTarget,
  serializeStaleAssetRecoveryLedger,
  STALE_ASSET_RECOVERY_LEDGER_KEY,
  STALE_ASSET_RECOVERY_STABILIZATION_MS,
  type StaleAssetAttestationVerdict,
  type StaleAssetRecoveryLedger,
  type StaleAssetRecoveryOutcome,
  type StaleAssetRecoveryState,
  type StaleAssetSuccessAttestation,
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

/**
 * Monotonic count of confirmed stale signals seen in this page.
 *
 * The stabilization window compares this before and after, which is how "no
 * immediate stale-asset event occurred while the recovered page settled" is
 * proved rather than assumed.
 */
let confirmedStaleSignals = 0;

let stabilizationTimer: ReturnType<typeof setTimeout> | null = null;

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
  confirmedStaleSignals = 0;
  if (stabilizationTimer !== null) clearTimeout(stabilizationTimer);
  stabilizationTimer = null;
  listeners.clear();
}

/** Test-only view of the confirmed-signal counter. */
export function confirmedStaleSignalCountForTest(): number {
  return confirmedStaleSignals;
}

// ---------------------------------------------------------------------------
// Ledger storage
// ---------------------------------------------------------------------------

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function resolveStorage(supplied?: StorageLike | null): StorageLike | null {
  // `undefined` means "not supplied — use the ambient store". An explicit
  // `null` means "there is no store", and must NOT silently fall back to one:
  // the caller is stating the condition under which a further reload could not
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

export type LedgerRead =
  | { status: "unavailable" }
  | { status: "malformed" }
  | { status: "ok"; ledger: StaleAssetRecoveryLedger };

export function readRecoveryLedger(now: number, storage?: StorageLike | null): LedgerRead {
  const store = resolveStorage(storage);
  if (!store) return { status: "unavailable" };
  let raw: string | null;
  try {
    raw = store.getItem(STALE_ASSET_RECOVERY_LEDGER_KEY);
  } catch {
    return { status: "unavailable" };
  }
  const parsed = parseStaleAssetRecoveryLedger(raw, now);
  if (parsed.status === "malformed") {
    // Removed so the tab is not stuck refusing for ever on one bad value. The
    // refusal below still stands for THIS signal: a malformed ledger never
    // silently becomes a fresh reload budget in the same decision.
    try {
      store.removeItem(STALE_ASSET_RECOVERY_LEDGER_KEY);
    } catch {
      /* nothing further to do */
    }
    return { status: "malformed" };
  }
  return { status: "ok", ledger: parsed.ledger };
}

function writeRecoveryLedger(
  ledger: StaleAssetRecoveryLedger,
  storage?: StorageLike | null,
): boolean {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.setItem(STALE_ASSET_RECOVERY_LEDGER_KEY, serializeStaleAssetRecoveryLedger(ledger));
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes the WHOLE ledger. Test-only and reset-only.
 *
 * Application code never calls this: erasing the history is exactly the defect
 * independent-review P1-2 recorded. Success clears the pending recovery through
 * `attestStaleAssetRecovery`, and nothing else clears anything.
 */
export function resetRecoveryLedgerForTest(storage?: StorageLike | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(STALE_ASSET_RECOVERY_LEDGER_KEY);
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
  ownClientAssetId?: string;
  readActiveClientAssetId?: () => Promise<string | null>;
  hasUnprovenWrite?: () => boolean;
};

export type StaleAssetRecoveryDecision = {
  verdict: StaleAssetVerdict;
  outcome: StaleAssetRecoveryOutcome;
};

/**
 * Classifies one failure and, at most once per transition and within the tab's
 * bounded budget, recovers from it.
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

  confirmedStaleSignals += 1;

  // A second channel reporting the SAME failure must not become a second
  // decision, a second build probe or a second reload.
  if (decisionInFlight) return { verdict, outcome: "already_handling" };
  decisionInFlight = true;

  // Ownership is taken synchronously the moment the classifier confirms, but
  // the decision below is asynchronous. `deciding` is what the root boundary
  // renders in between, so a confirmed stale failure never shows the generic
  // screen while its outcome is still being worked out (P2-1).
  setState("deciding");

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

  const read = readRecoveryLedger(now, storage);
  if (read.status === "unavailable") return refuse("storage_unavailable");
  if (read.status === "malformed") return refuse("malformed_state");
  const ledger = read.ledger;

  const ownClientAssetId = environment.ownClientAssetId ?? FOREVER_CLIENT_ASSET_ID;
  const readActive = environment.readActiveClientAssetId ?? (() => fetchActiveClientAssetId());
  const activeBuildId = await readActive();
  if (activeBuildId === null) return refuse("active_client_assets_unknown");
  if (activeBuildId === ownClientAssetId) return refuse("same_client_assets");

  const denial = ledgerBlocksTransition(ledger, ownClientAssetId, activeBuildId);
  if (denial) return refuse(denial);

  const wrote = writeRecoveryLedger(
    recordStaleAssetAttempt(ledger, {
      from: ownClientAssetId,
      to: activeBuildId,
      at: now,
      route: routeKindOf(environment.pathname),
    }),
    storage,
  );
  // The ledger is the ONLY thing preventing a further reload. If it could not
  // be written, the reload does not happen.
  if (!wrote) return refuse("storage_unavailable");

  // `decisionInFlight` deliberately stays set: the page is being replaced, and
  // any further signal arriving before it unloads must not start another
  // decision.
  setState("recovering");
  environment.reload(safeRecoveryTarget(environment.pathname, environment.search));
  return { verdict, outcome: "reload_issued" };
}

// ---------------------------------------------------------------------------
// Success attestation — the only thing allowed to clear a pending recovery
// ---------------------------------------------------------------------------

export type StaleAssetAttestationInput = Omit<
  StaleAssetSuccessAttestation,
  "clientAssetId" | "stabilizedWithoutStaleSignal"
> & {
  clientAssetId?: string;
};

/**
 * What actually happened, closed and honest (narrow-re-review RR2-P3-5).
 *
 *   refused    the attestation did not prove the pending recovery succeeded.
 *              Nothing was scheduled and nothing was cleared.
 *   scheduled  the attestation was accepted and the stabilization window is now
 *              running. The pending recovery is STILL SET, and it will only be
 *              cleared if the window passes with no further confirmed stale
 *              signal. It may legitimately never be cleared.
 *   cleared    the pending recovery is gone, verified by re-reading the ledger.
 *
 * The previous shape returned `cleared: true` the moment the window was
 * scheduled, which described an outcome that had not happened yet and could
 * still fail to happen. Enforcement was always real — the clear genuinely
 * waited — so this is a reporting correction, and the timing test below is what
 * keeps the two states distinguishable.
 */
export const STALE_ASSET_ATTESTATION_OUTCOMES = ["refused", "scheduled", "cleared"] as const;

export type StaleAssetAttestationOutcome = (typeof STALE_ASSET_ATTESTATION_OUTCOMES)[number];

export type StaleAssetAttestationResult = StaleAssetAttestationVerdict & {
  /** What happened. Never claims a clear that has not been observed. */
  outcome: StaleAssetAttestationOutcome;
  /** How many attempted transitions the ledger still remembers. */
  historyRetained: number;
};

/**
 * Records an explicit, exact-route success attestation.
 *
 * Nothing generic reaches this function. `router_resolved` is not an argument
 * it accepts, a root mount is not evidence it recognises, and a pathname that
 * does not match the pending recovery's route kind is refused outright — which
 * is what makes "Go to site", Back, an ordinary public navigation and a
 * redirect unable to erase anything.
 *
 * The stabilization clause is proved, not assumed: the confirmed-stale-signal
 * counter is sampled now and again after the bounded window, and the pending
 * recovery is cleared only if it did not move.
 *
 * THE RETURN VALUE REPORTS WHAT HAPPENED, NOT WHAT WAS INTENDED (RR2-P3-5).
 * Accepting the evidence only SCHEDULES the clear. Whether it happened is
 * established by re-reading the ledger after the window has been handed to the
 * scheduler — which is immediate for an injected synchronous scheduler, and is
 * one stabilization window later in a browser. `scheduled` and `cleared` are
 * therefore genuinely different answers, and a caller can no longer be told the
 * pending recovery is gone while it is still set.
 */
export function attestStaleAssetRecovery(
  input: StaleAssetAttestationInput,
  options: {
    now?: () => number;
    storage?: StorageLike | null;
    /** Injected so the stabilization window is testable without real time. */
    schedule?: (run: () => void, ms: number) => void;
    stabilizationMs?: number;
  } = {},
): StaleAssetAttestationResult {
  const now = (options.now ?? Date.now)();
  const read = readRecoveryLedger(now, options.storage);
  if (read.status !== "ok") {
    return {
      accepted: false,
      refusal: "no_pending_recovery",
      outcome: "refused",
      historyRetained: 0,
    };
  }
  const ledger = read.ledger;

  const attestation: StaleAssetSuccessAttestation = {
    ...input,
    clientAssetId: input.clientAssetId ?? FOREVER_CLIENT_ASSET_ID,
    // Sampled below. Assumed false here so a caller cannot assert it.
    stabilizedWithoutStaleSignal: true,
  };

  const verdict = attestationClearsPending(ledger.pending, attestation);
  if (!verdict.accepted) {
    return { ...verdict, outcome: "refused", historyRetained: ledger.history.length };
  }

  const signalsAtStart = confirmedStaleSignals;
  const finish = () => {
    stabilizationTimer = null;
    if (confirmedStaleSignals !== signalsAtStart) return;
    const later = readRecoveryLedger((options.now ?? Date.now)(), options.storage);
    if (later.status !== "ok" || !later.ledger.pending) return;
    writeRecoveryLedger(clearPendingRecovery(later.ledger), options.storage);
    setState("idle");
  };

  const schedule =
    options.schedule ??
    ((run: () => void, ms: number) => {
      if (stabilizationTimer !== null) clearTimeout(stabilizationTimer);
      stabilizationTimer = setTimeout(run, ms);
    });
  schedule(finish, options.stabilizationMs ?? STALE_ASSET_RECOVERY_STABILIZATION_MS);

  // Observed, never assumed. A synchronous scheduler has already run `finish`
  // by this line, so the pending slot is genuinely gone and `cleared` is true.
  // A real browser timer has not, so the honest answer is `scheduled`.
  const settled = readRecoveryLedger((options.now ?? Date.now)(), options.storage);
  const stillPending = settled.status === "ok" && settled.ledger.pending !== null;
  return {
    accepted: true,
    outcome: stillPending ? "scheduled" : "cleared",
    historyRetained: ledger.history.length,
  };
}

/** Read-only view of the ledger, for tests and for the harness. */
export function currentRecoveryLedger(
  now: number,
  storage?: StorageLike | null,
): StaleAssetRecoveryLedger {
  const read = readRecoveryLedger(now, storage);
  return read.status === "ok" ? read.ledger : emptyLedger();
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
