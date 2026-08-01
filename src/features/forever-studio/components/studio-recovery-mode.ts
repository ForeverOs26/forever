/**
 * Recovery authority and the deny-only recovery guard.
 *
 * Two states, kept strictly apart, because conflating them is how a URL string
 * turns into reset authority:
 *
 *   recoveryConfirmed — set ONLY by the Supabase `PASSWORD_RECOVERY` auth
 *     event. This is the only thing that may authorize `updateUser`.
 *
 *   recoveryBlocked — a deny-only union of the confirmed event, a
 *     non-authoritative URL landing hint, and an incomplete-termination marker.
 *     It can only REFUSE the dashboard. It can never authorize anything.
 *
 * Why the split: `type=recovery` is user-controlled text. Treating its presence
 * as recovery would let anyone holding an ordinary session append it to a URL
 * and be handled as though they had proved control of the mailbox.
 *
 * Why capture lives at module scope: Supabase parses the recovery link during
 * client start-up and emits `PASSWORD_RECOVERY` once, which can happen before
 * the reset component mounts. A listener registered in a component effect would
 * miss it. Installing here latches the EVENT KIND — a boolean — so a consumer
 * that subscribes later still sees it.
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

type RecoveryListener = () => void;

/** Authoritative: only the PASSWORD_RECOVERY auth event sets this. */
let recoveryConfirmed = false;
/** Non-authoritative: the reset URL looked like a recovery landing. */
let landingHint = false;
/** Deny-only: a password was updated but sign-out is not yet proved. */
let incompleteTermination = false;
let authSettled = false;
let installed = false;
let passwordUpdatedNotice = false;

const listeners = new Set<RecoveryListener>();
const settledListeners = new Set<RecoveryListener>();

function emit(): void {
  for (const listener of listeners) listener();
}

// ---------------------------------------------------------------------------
// Authority
// ---------------------------------------------------------------------------

/**
 * True only when Supabase itself reported PASSWORD_RECOVERY. The reset form may
 * become usable, and `updateUser` may be called, only when this is true AND a
 * live session exists.
 */
export function isStudioRecoveryConfirmed(): boolean {
  return recoveryConfirmed;
}

function confirmStudioRecovery(): void {
  if (recoveryConfirmed) return;
  recoveryConfirmed = true;
  emit();
}

// ---------------------------------------------------------------------------
// Deny-only guard
// ---------------------------------------------------------------------------

/**
 * True when Studio must refuse the dashboard. Deliberately broader than
 * `isStudioRecoveryConfirmed`: a mere landing hint, or an unterminated
 * recovery, is enough to withhold access, because withholding access is always
 * safe. Granting anything requires the confirmed event instead.
 */
export function isStudioRecoveryBlocked(): boolean {
  return recoveryConfirmed || landingHint || incompleteTermination;
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
 * Drops recovery authority. Safe only once the session is proved gone, so the
 * reset screen calls it exclusively on that path.
 */
export function clearStudioRecoveryMode(): void {
  if (!recoveryConfirmed && !landingHint) return;
  recoveryConfirmed = false;
  landingHint = false;
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

export function installStudioRecoveryCapture(): void {
  if (installed) return;
  installed = true;

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
      // The ONLY path to recovery authority. SIGNED_IN, INITIAL_SESSION and
      // TOKEN_REFRESHED are ordinary sessions and must never confirm recovery.
      if (event === "PASSWORD_RECOVERY") confirmStudioRecovery();
      // Any event proves start-up finished, whatever it was.
      markAuthSettled();
    });
  } catch {
    // A client that cannot subscribe (server render, misconfigured env) must
    // not break the page. Without the event there is no authority, which is
    // the fail-closed outcome.
  }
}

installStudioRecoveryCapture();
