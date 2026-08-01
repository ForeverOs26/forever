/**
 * Two facts, deliberately unequal in power, and never derived from each other.
 *
 *   RECOVERY DENY OBSERVED — "a recovery is happening somewhere on this
 *     origin". Establishable by a local OR broadcast `PASSWORD_RECOVERY` on the
 *     ordinary client, by the origin-wide deny marker, by an unterminated
 *     recovery, or by the URL landing hint. Its ONLY power is to refuse Studio.
 *
 *   LOCAL RECOVERY AUTHORITY — "THIS tab consumed and validated the recovery
 *     link". Establishable by exactly one thing: a `PASSWORD_RECOVERY` emitted
 *     by the DEDICATED, non-persistent recovery client in this tab. It is the
 *     only fact that may reveal the password form or authorize `updateUser`.
 *
 * WHY THE SPLIT IS NOT OPTIONAL. Verified against the pinned
 * `@supabase/auth-js` 2.110.0: `_getSessionFromURL()` emits
 * `PASSWORD_RECOVERY` through `_notifyAllSubscribers(..., broadcast = true)`,
 * which posts `{event, session}` on a `BroadcastChannel` named after the
 * storage key; every other same-origin tab re-dispatches it locally with
 * `broadcast = false`. The receiving callback sees the same event name and the
 * same live session as the tab that actually opened the link. An event name is
 * therefore proof of an origin-wide condition, never of local provenance.
 *
 * The dedicated client escapes this because auth-js gates BOTH the channel and
 * the storage on `persistSession`: with `persistSession: false` no channel is
 * ever constructed, so its `PASSWORD_RECOVERY` cannot have come from anywhere
 * but its own URL parse.
 *
 * Why capture lives at module scope: Supabase parses the link during client
 * start-up and emits once, which can happen before the reset component mounts.
 * Installing here latches the EVENT KIND — a boolean — so a later subscriber
 * still sees it.
 *
 * What is retained: booleans, and one sessionStorage marker holding the literal
 * "1". Never the recovery token, access token, refresh token, session object,
 * URL fragment, query string, email address, user id or password.
 */

import { supabase } from "@/integrations/supabase/client";

import {
  STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY,
  STUDIO_RECOVERY_INCOMPLETE_MARKER_VALUE,
  urlIsStudioRecoveryLanding,
} from "../studio-recovery-contract";
import { getStudioRecoveryClient } from "./studio-recovery-client";
import {
  clearStudioRecoverySharedDeny,
  holdStudioRecoveryClaim,
  installStudioRecoverySharedDeny,
  isStudioRecoverySharedDenyActive,
  releaseStudioRecoveryClaim,
  releaseStudioRecoverySharedDenyIfUnclaimed,
  setStudioRecoverySharedDeny,
  subscribeStudioRecoverySharedDeny,
} from "./studio-recovery-shared-deny";

type RecoveryListener = () => void;

/**
 * AUTHORITY. Set by the dedicated recovery client's own PASSWORD_RECOVERY and
 * by nothing else — not by the ordinary client, not by storage, not by a URL.
 */
let localRecoveryAuthority = false;
/** DENY-ONLY: a PASSWORD_RECOVERY was seen on the ordinary (shared) client. */
let denyObserved = false;
/** DENY-ONLY: the reset URL looked like a recovery landing. */
let landingHint = false;
/** DENY-ONLY: a password was updated but sign-out is not yet proved. */
let incompleteTermination = false;
let authSettled = false;
let installed = false;
let authorityInstalled = false;
let passwordUpdatedNotice = false;

const listeners = new Set<RecoveryListener>();
const settledListeners = new Set<RecoveryListener>();

function emit(): void {
  for (const listener of listeners) listener();
}

// ---------------------------------------------------------------------------
// Authority — the narrow half
// ---------------------------------------------------------------------------

/**
 * True only when THIS tab consumed and validated the recovery link, proved by a
 * PASSWORD_RECOVERY from the dedicated non-persistent client. The reset form may
 * appear, and `updateUser` may be called, only when this is true AND that
 * client holds a live session.
 */
export function isStudioLocalRecoveryAuthority(): boolean {
  return localRecoveryAuthority;
}

/**
 * The ONLY writer of authority. Private on purpose: it is reachable exclusively
 * from the dedicated client's own listener, installed below.
 */
function grantLocalRecoveryAuthority(): void {
  // Origin-wide denial first and unconditionally, before the early return and
  // before anything can await. A live recovery session exists at this instant,
  // so every other tab must be refused from this instant.
  //
  // The claim is taken in the same breath. The recovery session lives in this
  // tab's MEMORY and is invisible to every other tab's `getSession()`, so
  // without a claim to answer with, the next tab to look would see "no session
  // anywhere" and delete the denial as stale.
  holdStudioRecoveryClaim();
  setStudioRecoverySharedDeny();
  denyObserved = true;
  if (localRecoveryAuthority) return;
  localRecoveryAuthority = true;
  emit();
}

// ---------------------------------------------------------------------------
// Deny-only guard — the broad half
// ---------------------------------------------------------------------------

/**
 * Records that a recovery is under way somewhere on this origin.
 *
 * Called for a `PASSWORD_RECOVERY` seen on the ORDINARY client, which may have
 * been broadcast from another tab. It blocks Studio everywhere and grants
 * nothing anywhere.
 *
 * The origin-wide marker IS written here, exactly as before this correction.
 * Whatever produced the event, a live recovery session exists on this origin at
 * this instant, and refusing every tab is always safe. This is the cross-tab
 * dashboard guard added by the previous correction, deliberately left at full
 * strength: what changes in this correction is only that the event no longer
 * also confers reset AUTHORITY.
 */
export function noteStudioRecoveryDenyObserved(): void {
  setStudioRecoverySharedDeny();
  if (denyObserved) return;
  denyObserved = true;
  emit();
}

export function isStudioRecoveryDenyObserved(): boolean {
  return denyObserved;
}

/**
 * True when Studio must refuse the dashboard. Deliberately much broader than
 * `isStudioLocalRecoveryAuthority`: an observed event, a mere landing hint, an
 * unterminated recovery, or a recovery running in ANOTHER TAB of this origin is
 * each enough to withhold access, because withholding is always safe. Granting
 * anything requires local authority instead.
 *
 * The shared term is re-read from storage on every call. Caching it would leave
 * an already-open tab reporting `signed_in` for the rest of its life after
 * another tab entered recovery.
 */
export function isStudioRecoveryBlocked(): boolean {
  return (
    localRecoveryAuthority ||
    denyObserved ||
    landingHint ||
    incompleteTermination ||
    isStudioRecoverySharedDenyActive()
  );
}

/** True when the denial comes from the origin-wide marker. Deny-only. */
export function isStudioRecoverySharedBlocked(): boolean {
  return isStudioRecoverySharedDenyActive();
}

export function noteStudioRecoveryLandingHint(): void {
  if (landingHint) return;
  landingHint = true;
  emit();
}

export function isStudioRecoveryLandingHinted(): boolean {
  return landingHint;
}

// ---------------------------------------------------------------------------
// Incomplete-termination marker (survives reload; deny-only)
// ---------------------------------------------------------------------------

function readMarker(): boolean {
  try {
    return (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY) ===
        STUDIO_RECOVERY_INCOMPLETE_MARKER_VALUE
    );
  } catch {
    return false;
  }
}

export function markStudioRecoveryIncompleteTermination(): void {
  incompleteTermination = true;
  // Still the live recovery: a password was changed and sign-out is unproved.
  // Keep answering probes so no other tab retires the denial underneath it.
  holdStudioRecoveryClaim();
  // An unterminated recovery is exactly as dangerous in a second tab as in this
  // one — the session that would not close may be the shared one. Re-assert the
  // origin-wide denial rather than relying on it still being set.
  setStudioRecoverySharedDeny();
  try {
    sessionStorage.setItem(
      STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY,
      STUDIO_RECOVERY_INCOMPLETE_MARKER_VALUE,
    );
  } catch {
    // Storage unavailable: the in-memory flag still blocks this page life.
  }
  emit();
}

/**
 * Cleared ONLY after session absence has been positively confirmed. Every other
 * caller must leave it alone — clearing it early is precisely the failure this
 * marker exists to prevent.
 */
export function clearStudioRecoveryIncompleteTermination(): void {
  incompleteTermination = false;
  try {
    sessionStorage.removeItem(STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY);
  } catch {
    // Nothing more to do; the in-memory flag is already cleared.
  }
  emit();
}

export function isStudioRecoveryTerminationIncomplete(): boolean {
  return incompleteTermination;
}

/**
 * Releases the origin-wide denial and tells the other tabs.
 *
 * Separate from the clears above so the ORDER stays explicit at the call site:
 * local authority, then the tab-local marker, then the shared one, and only ever
 * after BOTH the recovery client and the ordinary client have RESOLVED
 * `getSession()` with `null`.
 */
export function clearStudioRecoverySharedBlock(): void {
  // Drop the claim FIRST: this tab is no longer the live recovery, and it must
  // not answer a probe that arrives after the release.
  releaseStudioRecoveryClaim();
  clearStudioRecoverySharedDeny();
  emit();
}

/**
 * Self-heal for a marker left behind by a crash, a closed tab or a killed
 * browser.
 *
 * MAY ONLY BE CALLED with positive session absence — a `getSession()` that
 * resolved with a null session. A rejection, a timeout, a network failure or an
 * unreadable storage is not absence and must never reach here, because clearing
 * on those would hand the dashboard to whatever session actually survived.
 *
 * Refuses while this tab holds any recovery state of its own: that tab is the
 * recovery, and its own screens release the guard when they finish.
 *
 * Absence in THIS tab is no longer enough on its own. Since the correction, a
 * live recovery session is held in the recovering tab's memory and is invisible
 * to every other tab, so "my `getSession()` resolved null" is the ordinary,
 * healthy state of a bystander tab during a reset. The release is therefore
 * deferred behind a liveness probe and happens only on silence — a genuinely
 * abandoned marker.
 */
export function noteStudioSessionPositivelyAbsent(): void {
  if (localRecoveryAuthority || denyObserved || landingHint || incompleteTermination) return;
  if (!isStudioRecoverySharedDenyActive()) return;
  // The release, and the notification that goes with it, happen inside — and
  // only on silence. Nothing is emitted here: this function is reached FROM a
  // session refresh, and emitting unconditionally would re-enter that refresh
  // for ever.
  releaseStudioRecoverySharedDenyIfUnclaimed();
}

/**
 * Drops recovery authority and the tab-local deny terms. Safe only once the
 * session is proved gone, so the reset screen calls it exclusively on that path.
 */
export function clearStudioRecoveryMode(): void {
  if (!localRecoveryAuthority && !landingHint && !denyObserved) return;
  localRecoveryAuthority = false;
  landingHint = false;
  denyObserved = false;
  emit();
}

export function subscribeStudioRecoveryMode(listener: RecoveryListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Auth start-up
// ---------------------------------------------------------------------------

export function isStudioAuthSettled(): boolean {
  return authSettled;
}

export function subscribeStudioAuthSettled(listener: RecoveryListener): () => void {
  settledListeners.add(listener);
  return () => {
    settledListeners.delete(listener);
  };
}

function markAuthSettled(): void {
  if (authSettled) return;
  authSettled = true;
  for (const listener of settledListeners) listener();
}

// ---------------------------------------------------------------------------
// One-shot notice for the sign-in screen
// ---------------------------------------------------------------------------

export function setStudioPasswordUpdatedNotice(): void {
  passwordUpdatedNotice = true;
}

export function consumeStudioPasswordUpdatedNotice(): boolean {
  const value = passwordUpdatedNotice;
  passwordUpdatedNotice = false;
  return value;
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

/**
 * Ordinary-client capture. DENY-ONLY, in every tab, on every page.
 *
 * The ordinary client runs with `detectSessionInUrl: false`, so it should never
 * produce a local `PASSWORD_RECOVERY` at all. If one arrives anyway — a
 * broadcast from a tab running older code, or a regenerated client that quietly
 * re-enabled URL detection — it is treated as evidence that a recovery is under
 * way SOMEWHERE, and refused accordingly. It never grants authority.
 */
export function installStudioRecoveryCapture(): void {
  if (installed) return;
  installed = true;

  // Cross-tab notification, wired before anything reads state: an already-open
  // tab has to react when ANOTHER tab enters recovery, and React rerender
  // timing is not a notification mechanism.
  installStudioRecoverySharedDeny();
  subscribeStudioRecoverySharedDeny(() => emit());

  // Deny-only: an unterminated recovery from before a reload still blocks.
  if (readMarker()) incompleteTermination = true;

  // Deny-only: the URL merely LOOKS like a recovery landing, and only on the
  // exact reset path. This grants nothing.
  if (typeof window !== "undefined" && window.location) {
    if (
      urlIsStudioRecoveryLanding(
        window.location.pathname ?? "",
        window.location.hash ?? "",
        window.location.search ?? "",
      )
    ) {
      landingHint = true;
    }
  }

  try {
    supabase.auth.onAuthStateChange((event) => {
      // DENY ONLY. This callback cannot distinguish an event this tab produced
      // from one auth-js re-dispatched out of another tab's BroadcastChannel
      // message, so it is never allowed to grant anything. SIGNED_IN,
      // INITIAL_SESSION and TOKEN_REFRESHED are ordinary sessions and do not
      // even deny.
      if (event === "PASSWORD_RECOVERY") noteStudioRecoveryDenyObserved();
      // Any event proves start-up finished, whatever it was.
      markAuthSettled();
    });
  } catch {
    // A client that cannot subscribe (server render, misconfigured env) must
    // not break the page. Without the event there is no authority, which is
    // the fail-closed outcome.
  }
}

/**
 * Dedicated-client installation — the ONLY route to authority.
 *
 * Called exclusively by the reset screen. Constructing the client is what makes
 * it parse `window.location`, and the listener is registered SYNCHRONOUSLY
 * afterwards so the `PASSWORD_RECOVERY` that parse produces (dispatched from a
 * `setTimeout(..., 0)` inside `_initialize`) cannot be missed.
 */
export function installStudioRecoveryAuthority(): void {
  if (authorityInstalled) return;
  authorityInstalled = true;

  const recoveryClient = getStudioRecoveryClient();
  if (!recoveryClient) {
    // No client, no authority. Start-up still has to be able to settle, or the
    // screen would sit on "Checking the reset link…" for ever.
    markAuthSettled();
    return;
  }

  try {
    recoveryClient.auth.onAuthStateChange((event) => {
      // This client has no BroadcastChannel (auth-js only builds one when
      // `persistSession` is true), so this event cannot have come from another
      // tab. It is proof that THIS tab parsed the link and the server accepted
      // the token — the one fact allowed to become authority.
      if (event === "PASSWORD_RECOVERY") grantLocalRecoveryAuthority();
      markAuthSettled();
    });
  } catch {
    markAuthSettled();
  }
}

installStudioRecoveryCapture();
