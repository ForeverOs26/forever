/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the recovery contract.
 *
 * Pure constants and closed vocabularies, free of DOM, storage, network,
 * router, React and Supabase imports so every rule can be tested directly.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A LEDGER AND NOT A MARKER (independent-review P1-1)
 * ---------------------------------------------------------------------------
 *
 * The reviewed design stored ONE slot holding one ordered `from → to`
 * transition, overwritten on every write. That bounds reloads per transition
 * and bounds nothing else: a tab can observe an unbounded number of distinct
 * transitions, so it can perform an unbounded number of automatic reloads. The
 * independent review measured 12; driving the same machine against a strictly
 * alternating edge produced 40 from 40 signals. The runbook's own rollback step
 * (`A → B` then `B → A`) was enough to grant a second automatic reload on a tab
 * that had already recovered.
 *
 * So the single slot is replaced by a LEDGER with two separate concepts:
 *
 *   1. PENDING RECOVERY — the one transition this tab has issued a reload for
 *      and has not yet proved successful. Exactly zero or one exists.
 *   2. HISTORY — a bounded record of transitions this tab has ALREADY spent an
 *      automatic attempt on. It survives success, survives navigation, survives
 *      "Go to site", survives Back, and is never erased by anything except its
 *      own TTL.
 *
 * The reload budget is therefore bounded twice over, and both bounds are
 * policy, not luck:
 *
 *   - `STALE_ASSET_RECOVERY_MAX_TRANSITION_ATTEMPTS` — one automatic reload per
 *     ordered `from → to` pair, ever;
 *   - `STALE_ASSET_RECOVERY_MAX_TAB_ATTEMPTS` — a hard ceiling on automatic
 *     reloads per tab per TTL window, which is what makes a genuinely
 *     progressing sequence of releases (`A → B → C → D …`) finite as well.
 *
 * A ↔ B alternating for ever therefore costs at most two automatic reloads
 * (one for `A → B`, one for `B → A`), and the ceiling caps everything else. The
 * maximum is bounded by this policy, never by how long the origin flaps.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE LEDGER MAY CONTAIN — and this list is exhaustive
 * ---------------------------------------------------------------------------
 *
 *   - a fixed schema version;
 *   - public build identifiers (`from`, `to`), each matching the bounded
 *     public pattern and nothing else;
 *   - a closed-vocabulary ROUTE KIND for the pending recovery — never a
 *     pathname, never a query, never a parameter, never a slug or id;
 *   - bounded millisecond timestamps used only for expiry.
 *
 * WHAT IT MUST NEVER CONTAIN. A token, an access or refresh token, an email, a
 * user id, a job id, a filename, an object key, an asset URL, a query string, a
 * fragment, a stack trace, an error message, a route path, or any private route
 * data. The validator refuses any object carrying an unknown key, refuses any
 * value outside its bounded shape, and refuses the whole ledger rather than
 * silently keeping the parts it liked — so this is enforced, not intended.
 *
 * WHY A ROUTE KIND RATHER THAN THE PATHNAME. The success attestation has to
 * prove the recovered page came back to the page it left, and the obvious way
 * is to store the pathname. That is forbidden here: a stored pathname is stored
 * route data, and `/studio/project/<slug>` carries a private identifier. The
 * closed route-kind vocabulary below is what the requirement's actual failure
 * mode needs — it makes `/` (public root) unable to attest a `/studio/upload`
 * recovery — while the LIVE pathname, which the attestation reads directly from
 * the document and never stores, is additionally required to normalise to that
 * same kind.
 *
 * DENY-ONLY. The ledger's only power is to REFUSE an automatic reload. A forged
 * or cleared ledger costs the visitor one manual reload button and nothing
 * else: it can never cause a reload, never grant access, never authorise an
 * action and never resubmit anything. Every reload additionally requires a
 * proven build difference, a permitted route, and no unproven write.
 */

import { FOREVER_CLIENT_ASSET_ID_PATTERN } from "./client-asset-id-contract";

export { FOREVER_CLIENT_ASSET_ID_PATTERN };

/** sessionStorage key for the deny-only recovery ledger. */
export const STALE_ASSET_RECOVERY_LEDGER_KEY = "forever.app.stale-asset.recovery";

/** Ledger schema version. Any other value makes the whole ledger malformed. */
export const STALE_ASSET_RECOVERY_LEDGER_SCHEMA = 2;

/** One automatic reload per ordered `from → to` transition, ever. */
export const STALE_ASSET_RECOVERY_MAX_TRANSITION_ATTEMPTS = 1;

/**
 * The hard ceiling on automatic reloads in one tab within one TTL window.
 *
 * This is the explicit, finite, documented policy for genuinely later builds.
 * Without it a tab that walked `A → B → C → D → …` would get a fresh attempt
 * for every new release, which is bounded only by how often the origin changes
 * — the exact property the independent review proved was missing.
 *
 * Three is chosen deliberately: a release, an immediate corrective release, and
 * one more. Beyond that the honest answer is the recovery screen and a human.
 */
export const STALE_ASSET_RECOVERY_MAX_TAB_ATTEMPTS = 3;

/**
 * The strict maximum number of history entries the ledger may ever hold.
 *
 * Larger than the attempt ceiling on purpose: the ceiling bounds what THIS
 * build writes, and this bounds what any ledger — including one written by an
 * older schema, a duplicated tab or a hand-edited value — is allowed to be.
 * A ledger with more entries than this is malformed and is refused whole.
 */
export const STALE_ASSET_RECOVERY_MAX_HISTORY = 8;

/**
 * The maximum serialized length accepted from storage.
 *
 * RECONCILED WITH `STALE_ASSET_RECOVERY_MAX_HISTORY` (narrow-re-review
 * RR2-P3-4). The previous value was 512, and at production identifier length a
 * full history could not fit inside it: one history entry
 * (`{"from":"<32>","to":"<32>","at":<13>}`) serializes to 102 bytes, so eight
 * entries plus a pending record plus the wrapper reach 983. The declared
 * maximum of eight was therefore unreachable, and the REAL bound was the byte
 * cap at four entries — a limit nothing documented.
 *
 * Two honest fixes existed: lower the declared maximum to what the cap allows,
 * or raise the cap so the declared maximum is reachable. The second is chosen
 * because the history's whole purpose is to remember MORE attempted transitions
 * than a tab is ever allowed to spend, and shrinking it would weaken the
 * deny-only guarantee to save bytes in a store measured in megabytes.
 *
 * 1024 is the worst case (983) plus headroom, and it is still a hard bound: a
 * value longer than this is malformed and the whole ledger is refused.
 * `stale-asset-recovery.test.ts` constructs the exact worst case and asserts
 * both that it fits and that one byte more is refused.
 */
export const STALE_ASSET_RECOVERY_MAX_SERIALIZED_BYTES = 1024;

/**
 * How long a history entry stays meaningful.
 *
 * A tab left open across several days of releases must not be permanently
 * barred from recovering. Twelve hours comfortably covers one working day.
 */
export const STALE_ASSET_RECOVERY_HISTORY_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * How long a PENDING recovery stays pending before it is abandoned.
 *
 * A pending record that is never attested means the reload did not produce a
 * usable page. It expires so the tab is not stuck reporting a recovery in
 * progress for ever; the HISTORY entry it left behind is what keeps the
 * transition from being retried, and that entry outlives this window.
 */
export const STALE_ASSET_RECOVERY_PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * How long a recovered page must run without a further stale-asset signal
 * before its recovery is attested as successful.
 *
 * A leaf that mounts and immediately fails on its next chunk has not recovered.
 */
export const STALE_ASSET_RECOVERY_STABILIZATION_MS = 1500;

/** Tolerance for a timestamp that reads as being in the future. */
export const STALE_ASSET_RECOVERY_CLOCK_SKEW_MS = 60_000;

/** Every state the recovery machine can be in. Nothing outside this list exists. */
export const STALE_ASSET_RECOVERY_STATES = [
  "idle",
  /**
   * A confirmed stale failure is being decided RIGHT NOW and the outcome is not
   * known yet (independent-review P2-1).
   *
   * This is a first-class state because ownership is taken synchronously — the
   * capture layer calls `preventDefault()` the moment the classifier confirms —
   * while the decision itself is asynchronous, because it must ask the origin
   * which build it is serving. Between those two moments the boundary must
   * already show the specific update screen, never the generic one.
   */
  "deciding",
  "recovering",
  "recovery_required",
] as const;

export type StaleAssetRecoveryState = (typeof STALE_ASSET_RECOVERY_STATES)[number];

/** True when the root boundary must render the specific update/recovery screen. */
export function stateRendersRecoveryScreen(state: StaleAssetRecoveryState): boolean {
  return state !== "idle";
}

/**
 * Every outcome one recovery decision can produce. Closed so a caller cannot
 * invent another behaviour, and so the tests can enumerate the whole surface.
 */
export const STALE_ASSET_RECOVERY_OUTCOMES = [
  /** Not a stale versioned asset. Nothing happens; the ordinary error path runs. */
  "not_stale",
  /** Confirmed stale, safe, and the origin really is on a different build. One reload issued. */
  "reload_issued",
  /** Confirmed stale, but this tab already spent its attempt on that exact transition. */
  "attempt_already_used",
  /** Confirmed stale, but this tab has spent its whole automatic budget. */
  "recovery_budget_spent",
  /**
   * Confirmed stale, but a decision for an earlier signal is still running or
   * has already issued the reload. One failure reaches the page on more than
   * one channel — `vite:preloadError` and the modulepreload element's own
   * `error` both fire for the same missing chunk — and each must not become its
   * own decision, its own client asset probe and its own reload.
   */
  "already_handling",
  /** Confirmed stale, but the origin reports the SAME client assets. A reload would prove nothing. */
  "same_client_assets",
  /** Confirmed stale, but the active client asset identity could not be read. Refuse rather than guess. */
  "active_client_assets_unknown",
  /** Confirmed stale, but a consequential action's outcome is unproven. Never reload. */
  "write_in_flight",
  /** Confirmed stale on a route where an automatic reload is never permitted. */
  "route_denied",
  /** No storage to record the attempt in, so a second reload could not be prevented. */
  "storage_unavailable",
  /** Storage held something that is not a valid ledger. Refuse and start clean. */
  "malformed_state",
] as const;

export type StaleAssetRecoveryOutcome = (typeof STALE_ASSET_RECOVERY_OUTCOMES)[number];

/** Outcomes that are a CONFIRMED stale failure with no automatic reload happening. */
export const STALE_ASSET_RECOVERY_DENIALS: readonly StaleAssetRecoveryOutcome[] = [
  "attempt_already_used",
  "recovery_budget_spent",
  "same_client_assets",
  "active_client_assets_unknown",
  "write_in_flight",
  "route_denied",
  "storage_unavailable",
  "malformed_state",
] as const;

export function outcomeIsDenial(outcome: StaleAssetRecoveryOutcome): boolean {
  return STALE_ASSET_RECOVERY_DENIALS.includes(outcome);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

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

export function normalizePathname(pathname: string): string {
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}

export function routeForbidsAutomaticRecovery(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return STALE_ASSET_RECOVERY_DENIED_ROUTES.some(
    (denied) => path === denied || path.startsWith(`${denied}/`),
  );
}

export const STALE_ASSET_STUDIO_ROUTE_PREFIX = "/studio";

export function routeRequiresStudioShellProof(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return (
    path === STALE_ASSET_STUDIO_ROUTE_PREFIX ||
    path.startsWith(`${STALE_ASSET_STUDIO_ROUTE_PREFIX}/`)
  );
}

/**
 * The closed vocabulary of route KINDS the ledger is allowed to remember.
 *
 * Deliberately coarse. A kind names which leaf must load, and nothing about
 * which project, listing, job or query the visitor was looking at.
 */
export const STALE_ASSET_ROUTE_KINDS = [
  "public",
  "studio_dashboard",
  "studio_upload",
  "studio_members",
  "studio_project",
  "studio_resale",
  "studio_reset_password",
  "studio_forgot_password",
  "studio_other",
] as const;

export type StaleAssetRouteKind = (typeof STALE_ASSET_ROUTE_KINDS)[number];

export function isStaleAssetRouteKind(value: unknown): value is StaleAssetRouteKind {
  return (
    typeof value === "string" && (STALE_ASSET_ROUTE_KINDS as readonly string[]).includes(value)
  );
}

/** Maps a live pathname to its bounded kind. Never retains any part of the path. */
export function routeKindOf(pathname: string): StaleAssetRouteKind {
  const path = normalizePathname(pathname);
  if (path === "/studio/reset-password" || path.startsWith("/studio/reset-password/")) {
    return "studio_reset_password";
  }
  if (path === "/studio/forgot-password" || path.startsWith("/studio/forgot-password/")) {
    return "studio_forgot_password";
  }
  if (path === "/studio") return "studio_dashboard";
  if (path === "/studio/upload") return "studio_upload";
  if (path === "/studio/members") return "studio_members";
  if (path.startsWith("/studio/project/")) return "studio_project";
  if (path.startsWith("/studio/resale/")) return "studio_resale";
  if (path.startsWith("/studio/")) return "studio_other";
  return "public";
}

/** Kinds whose attestation additionally requires an authenticated, usable Studio. */
export const STALE_ASSET_AUTHENTICATED_STUDIO_KINDS: readonly StaleAssetRouteKind[] = [
  "studio_dashboard",
  "studio_upload",
  "studio_members",
  "studio_project",
  "studio_resale",
] as const;

export function routeKindRequiresAuthenticatedStudio(kind: StaleAssetRouteKind): boolean {
  return STALE_ASSET_AUTHENTICATED_STUDIO_KINDS.includes(kind);
}

/**
 * The ONE documented safe redirect.
 *
 * A recovery that targeted a bare Studio route may legitimately settle on the
 * dashboard index, because `/studio` renders the dashboard. Nothing else is a
 * safe redirect: landing on `/` after a `/studio/upload` recovery is a
 * DIFFERENT page, and treating it as success is precisely independent-review
 * P1-2 — the recovery screen's own "Go to site" clearing the guard it exists to
 * enforce.
 */
export const STALE_ASSET_SAFE_REDIRECTS: ReadonlyArray<{
  readonly from: StaleAssetRouteKind;
  readonly to: StaleAssetRouteKind;
  readonly why: string;
}> = [
  {
    from: "studio_other",
    to: "studio_dashboard",
    why: "an unrecognised /studio/* path renders the dashboard index",
  },
] as const;

export function routeKindSatisfiesTarget(
  target: StaleAssetRouteKind,
  observed: StaleAssetRouteKind,
): boolean {
  if (target === observed) return true;
  return STALE_ASSET_SAFE_REDIRECTS.some(
    (redirect) => redirect.from === target && redirect.to === observed,
  );
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

export type StaleAssetTransitionAttempt = {
  from: string;
  to: string;
  at: number;
};

export type StaleAssetPendingRecovery = StaleAssetTransitionAttempt & {
  route: StaleAssetRouteKind;
};

export type StaleAssetRecoveryLedger = {
  v: typeof STALE_ASSET_RECOVERY_LEDGER_SCHEMA;
  pending: StaleAssetPendingRecovery | null;
  history: StaleAssetTransitionAttempt[];
};

const LEDGER_KEYS = ["v", "pending", "history"] as const;
const PENDING_KEYS = ["from", "to", "at", "route"] as const;
const ATTEMPT_KEYS = ["from", "to", "at"] as const;

export const EMPTY_STALE_ASSET_RECOVERY_LEDGER: StaleAssetRecoveryLedger = Object.freeze({
  v: STALE_ASSET_RECOVERY_LEDGER_SCHEMA,
  pending: null,
  history: Object.freeze([]) as unknown as StaleAssetTransitionAttempt[],
});

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) return false;
  return true;
}

function boundedTimestamp(value: unknown, now: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return null;
  if (value <= 0) return null;
  // A timestamp in the future is CLAMPED, never dropped. A clock that jumps
  // backwards must not be able to erase this tab's history and hand it a fresh
  // reload budget — that would turn a clock shift into a reload loop.
  if (value > now + STALE_ASSET_RECOVERY_CLOCK_SKEW_MS) return now;
  return value;
}

function parseAttempt(value: unknown, now: number): StaleAssetTransitionAttempt | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!hasOnlyKeys(candidate, ATTEMPT_KEYS)) return null;
  const { from, to } = candidate;
  if (typeof from !== "string" || !FOREVER_CLIENT_ASSET_ID_PATTERN.test(from)) return null;
  if (typeof to !== "string" || !FOREVER_CLIENT_ASSET_ID_PATTERN.test(to)) return null;
  const at = boundedTimestamp(candidate.at, now);
  if (at === null) return null;
  return { from, to, at };
}

function parsePending(value: unknown, now: number): StaleAssetPendingRecovery | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!hasOnlyKeys(candidate, PENDING_KEYS)) return null;
  if (!isStaleAssetRouteKind(candidate.route)) return null;
  const attempt = parseAttempt({ from: candidate.from, to: candidate.to, at: candidate.at }, now);
  if (!attempt) return null;
  return { ...attempt, route: candidate.route };
}

export type StaleAssetLedgerParse =
  | { status: "absent"; ledger: StaleAssetRecoveryLedger }
  | { status: "ok"; ledger: StaleAssetRecoveryLedger }
  | { status: "malformed"; ledger: StaleAssetRecoveryLedger };

/**
 * Strict validation. Anything unexpected — a wrong schema, an unbounded
 * identifier, an unknown key, a route outside the closed vocabulary, a history
 * longer than the ceiling, a non-integer timestamp — makes the WHOLE ledger
 * malformed. Nothing is partially salvaged, because salvaging is how a forged
 * value keeps the parts that help it.
 *
 * A malformed ledger is reported as such rather than silently treated as
 * absent, so the decision can REFUSE this signal (`malformed_state`) and show
 * the specific screen instead of quietly handing out a fresh reload budget.
 */
export function parseStaleAssetRecoveryLedger(raw: unknown, now: number): StaleAssetLedgerParse {
  const absent = { status: "absent", ledger: emptyLedger() } as const;
  if (raw === null || raw === undefined) return absent;
  if (typeof raw !== "string" || raw.length === 0) return absent;
  if (raw.length > STALE_ASSET_RECOVERY_MAX_SERIALIZED_BYTES) {
    return { status: "malformed", ledger: emptyLedger() };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "malformed", ledger: emptyLedger() };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { status: "malformed", ledger: emptyLedger() };
  }

  const candidate = parsed as Record<string, unknown>;
  if (!hasOnlyKeys(candidate, LEDGER_KEYS)) return { status: "malformed", ledger: emptyLedger() };
  if (candidate.v !== STALE_ASSET_RECOVERY_LEDGER_SCHEMA) {
    return { status: "malformed", ledger: emptyLedger() };
  }
  if (!Array.isArray(candidate.history)) return { status: "malformed", ledger: emptyLedger() };
  if (candidate.history.length > STALE_ASSET_RECOVERY_MAX_HISTORY) {
    return { status: "malformed", ledger: emptyLedger() };
  }

  const history: StaleAssetTransitionAttempt[] = [];
  for (const entry of candidate.history) {
    const attempt = parseAttempt(entry, now);
    if (!attempt) return { status: "malformed", ledger: emptyLedger() };
    // Expiry is not malformation: an entry older than the TTL is simply gone.
    if (now - attempt.at > STALE_ASSET_RECOVERY_HISTORY_TTL_MS) continue;
    history.push(attempt);
  }

  if (!("pending" in candidate)) return { status: "malformed", ledger: emptyLedger() };
  let pending = parsePending(candidate.pending, now);
  if (candidate.pending !== null && pending === null) {
    return { status: "malformed", ledger: emptyLedger() };
  }
  if (pending && now - pending.at > STALE_ASSET_RECOVERY_PENDING_TTL_MS) pending = null;

  return {
    status: "ok",
    ledger: { v: STALE_ASSET_RECOVERY_LEDGER_SCHEMA, pending, history },
  };
}

export function emptyLedger(): StaleAssetRecoveryLedger {
  return { v: STALE_ASSET_RECOVERY_LEDGER_SCHEMA, pending: null, history: [] };
}

export function serializeStaleAssetRecoveryLedger(ledger: StaleAssetRecoveryLedger): string {
  // Key order is fixed so the serialized form is stable and reviewable, and
  // every field is rebuilt explicitly so nothing a caller attached can ride
  // along into storage.
  return JSON.stringify({
    v: STALE_ASSET_RECOVERY_LEDGER_SCHEMA,
    pending: ledger.pending
      ? {
          from: ledger.pending.from,
          to: ledger.pending.to,
          at: ledger.pending.at,
          route: ledger.pending.route,
        }
      : null,
    history: ledger.history
      .slice(-STALE_ASSET_RECOVERY_MAX_HISTORY)
      .map((entry) => ({ from: entry.from, to: entry.to, at: entry.at })),
  });
}

/** Why the ledger refuses this transition, or `null` when it permits it. */
export type StaleAssetLedgerDenial = "attempt_already_used" | "recovery_budget_spent";

export function ledgerBlocksTransition(
  ledger: StaleAssetRecoveryLedger,
  from: string,
  to: string,
): StaleAssetLedgerDenial | null {
  const spentOnThisTransition = ledger.history.filter(
    (entry) => entry.from === from && entry.to === to,
  ).length;
  if (spentOnThisTransition >= STALE_ASSET_RECOVERY_MAX_TRANSITION_ATTEMPTS) {
    return "attempt_already_used";
  }
  // The pending record counts too: a reload already issued for this exact
  // transition has spent the attempt even if the page never came back to write
  // its history entry.
  if (ledger.pending && ledger.pending.from === from && ledger.pending.to === to) {
    return "attempt_already_used";
  }
  if (ledger.history.length >= STALE_ASSET_RECOVERY_MAX_TAB_ATTEMPTS) {
    return "recovery_budget_spent";
  }
  return null;
}

/**
 * Records one attempt: it becomes the pending recovery AND is appended to the
 * history in the same write.
 *
 * Appending immediately — before the reload, never after — is what makes the
 * history survive a reload that never comes back, a tab that is closed, and a
 * page that lands somewhere unexpected. The pending record is the part that
 * later clears; the history entry is the part that never does.
 */
export function recordStaleAssetAttempt(
  ledger: StaleAssetRecoveryLedger,
  attempt: StaleAssetPendingRecovery,
): StaleAssetRecoveryLedger {
  const history = [...ledger.history, { from: attempt.from, to: attempt.to, at: attempt.at }].slice(
    -STALE_ASSET_RECOVERY_MAX_HISTORY,
  );
  return { v: STALE_ASSET_RECOVERY_LEDGER_SCHEMA, pending: attempt, history };
}

/** Clears ONLY the pending recovery. History is never touched here. */
export function clearPendingRecovery(ledger: StaleAssetRecoveryLedger): StaleAssetRecoveryLedger {
  if (!ledger.pending) return ledger;
  return { v: STALE_ASSET_RECOVERY_LEDGER_SCHEMA, pending: null, history: ledger.history };
}

// ---------------------------------------------------------------------------
// Success attestation (independent-review P1-2)
// ---------------------------------------------------------------------------

/**
 * The evidence a page must supply before a pending recovery may be cleared.
 *
 * The reviewed design cleared on a bare `router_resolved` for ANY non-Studio
 * pathname, which meant the recovery screen's own "Go to site" link walked the
 * visitor through the clear and re-armed the identical broken transition. Route
 * resolution is not success. This is.
 */
export type StaleAssetSuccessAttestation = {
  /** The CLIENT ASSET identifier this page is actually running. */
  clientAssetId: string;
  /** The live pathname, read from the document and never stored. */
  pathname: string;
  /** The intended leaf route module for this pathname finished loading. */
  leafRouteLoaded: boolean;
  /** Every nested lazy module this route needs finished loading. */
  nestedModulesLoaded: boolean;
  /** The route did NOT settle into an error boundary. */
  errorBoundaryActive: boolean;
  /**
   * For an authenticated Studio route: the route reached a usable authenticated
   * state — dashboard overview ready, uploader leaf mounted, members leaf and
   * its data boundary resolved. A shell mount, a root mount, a sign-in screen
   * and an interstitial are all explicitly NOT this.
   */
  studioAuthenticatedReady: boolean;
  /** No further stale-asset signal arrived during the stabilization window. */
  stabilizedWithoutStaleSignal: boolean;
};

export const STALE_ASSET_ATTESTATION_REFUSALS = [
  "no_pending_recovery",
  "client_assets_are_not_the_recovery_target",
  "route_is_not_the_recovery_target",
  "leaf_route_not_loaded",
  "nested_modules_not_loaded",
  "error_boundary_active",
  "studio_not_authenticated_ready",
  "not_stabilized",
] as const;

export type StaleAssetAttestationRefusal = (typeof STALE_ASSET_ATTESTATION_REFUSALS)[number];

export type StaleAssetAttestationVerdict =
  | { accepted: true }
  | { accepted: false; refusal: StaleAssetAttestationRefusal };

/**
 * Decides whether an attestation proves the pending recovery succeeded.
 *
 * Every clause can only REFUSE. There is no path here that clears a pending
 * recovery on weaker evidence than the full set, and there is no path here at
 * all that touches the history.
 */
export function attestationClearsPending(
  pending: StaleAssetPendingRecovery | null,
  attestation: StaleAssetSuccessAttestation,
): StaleAssetAttestationVerdict {
  if (!pending) return { accepted: false, refusal: "no_pending_recovery" };
  if (attestation.clientAssetId !== pending.to) {
    return { accepted: false, refusal: "client_assets_are_not_the_recovery_target" };
  }
  const observed = routeKindOf(attestation.pathname);
  if (!routeKindSatisfiesTarget(pending.route, observed)) {
    return { accepted: false, refusal: "route_is_not_the_recovery_target" };
  }
  if (!attestation.leafRouteLoaded) return { accepted: false, refusal: "leaf_route_not_loaded" };
  if (!attestation.nestedModulesLoaded) {
    return { accepted: false, refusal: "nested_modules_not_loaded" };
  }
  if (attestation.errorBoundaryActive) return { accepted: false, refusal: "error_boundary_active" };
  if (routeKindRequiresAuthenticatedStudio(observed) && !attestation.studioAuthenticatedReady) {
    return { accepted: false, refusal: "studio_not_authenticated_ready" };
  }
  if (!attestation.stabilizedWithoutStaleSignal) {
    return { accepted: false, refusal: "not_stabilized" };
  }
  return { accepted: true };
}

/**
 * The route and query the recovered page must come back to.
 *
 * The fragment is deliberately DROPPED. It is the only part of a URL this
 * application ever uses to carry authentication material (the Supabase recovery
 * link), and replaying a fragment automatically is exactly the thing the
 * password-recovery guard exists to prevent. Path and query — the parts that
 * describe which page the visitor was on — are preserved exactly, and neither
 * is ever written to the ledger.
 */
export function safeRecoveryTarget(pathname: string, search: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (!search || search === "?") return path;
  return `${path}${search.startsWith("?") ? search : `?${search}`}`;
}
