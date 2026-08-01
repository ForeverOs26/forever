/**
 * Central capture of the Supabase PASSWORD_RECOVERY event.
 *
 * Why this is not inside a component: Supabase parses the recovery link during
 * client initialisation and emits PASSWORD_RECOVERY once, which can happen
 * before the reset-password component has mounted. A listener registered in a
 * component effect would miss it and the user would see a false
 * "invalid or expired link". Installation therefore happens at module scope,
 * as soon as anything in the Studio graph is imported.
 *
 * What is retained: a single in-memory boolean, plus a one-shot notice flag for
 * the sign-in screen. Nothing else.
 *
 * What is NEVER retained, anywhere: the recovery token, the access or refresh
 * token, the session object, the URL fragment, the query string, the email
 * address or the password. The URL is inspected only for its `type` parameter
 * (see `urlDeclaresPasswordRecovery`) and nothing is written to localStorage,
 * sessionStorage, cookies, application state or logs by this module.
 */

import { supabase } from "@/integrations/supabase/client";

import { urlDeclaresPasswordRecovery } from "../studio-recovery-contract";

type RecoveryListener = (active: boolean) => void;

let recoveryMode = false;
let installed = false;
let passwordUpdatedNotice = false;
let authSettled = false;
const listeners = new Set<RecoveryListener>();
const settledListeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener(recoveryMode);
}

/**
 * True once the auth client has emitted anything at all, which means its
 * start-up (including any parsing of a link in the URL) has completed.
 *
 * The reset screen uses this to reach a fast, correct verdict: before start-up
 * finishes, the absence of a recovery proves nothing; after it finishes, a
 * link that produced no recovery is genuinely not a usable recovery link.
 */
export function isStudioAuthSettled(): boolean {
  return authSettled;
}

export function subscribeStudioAuthSettled(listener: () => void): () => void {
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

/** True while a recovery link is being completed in this tab. */
export function isStudioRecoveryMode(): boolean {
  return recoveryMode;
}

/**
 * Enters recovery mode. Called by the auth-event listener and by the
 * synchronous URL check; never called with, and never given, a token.
 */
export function markStudioRecoveryMode(): void {
  if (recoveryMode) return;
  recoveryMode = true;
  emit();
}

/**
 * Leaves recovery mode. Called after the password has been updated and the
 * recovery session signed out, and when a normal sign-in supersedes it.
 */
export function clearStudioRecoveryMode(): void {
  if (!recoveryMode) return;
  recoveryMode = false;
  emit();
}

export function subscribeStudioRecoveryMode(listener: RecoveryListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * One-shot flag so the sign-in screen can confirm the password change without
 * putting anything in the URL. Reading it consumes it.
 */
export function setStudioPasswordUpdatedNotice(): void {
  passwordUpdatedNotice = true;
}

export function consumeStudioPasswordUpdatedNotice(): boolean {
  const value = passwordUpdatedNotice;
  passwordUpdatedNotice = false;
  return value;
}

/**
 * Installs recovery capture exactly once per module instance.
 *
 * Two independent signals, because either alone can be missed:
 *
 *  1. A synchronous check of the current URL's `type` parameter. This runs
 *     before any component mounts and before the auth client finishes its
 *     asynchronous start-up, so a recovery landing is recognised immediately.
 *  2. The PASSWORD_RECOVERY auth event, which is authoritative and also covers
 *     a link opened through a route transition.
 *
 * Registration is synchronous with the first touch of `supabase.auth`, so the
 * listener is attached before the client can emit anything.
 */
export function installStudioRecoveryCapture(): void {
  if (installed) return;
  installed = true;

  if (typeof window !== "undefined" && window.location) {
    if (urlDeclaresPasswordRecovery(window.location.hash ?? "", window.location.search ?? "")) {
      markStudioRecoveryMode();
    }
  }

  try {
    supabase.auth.onAuthStateChange((event) => {
      // ONLY this event enters recovery mode. A normal SIGNED_IN must never be
      // treated as a recovery, or a routine sign-in would be diverted into the
      // reset screen and blocked from the dashboard.
      if (event === "PASSWORD_RECOVERY") markStudioRecoveryMode();
      // Any event proves start-up finished, whatever it was.
      markAuthSettled();
    });
  } catch {
    // A client that cannot subscribe (server render, misconfigured env) must
    // not break the page; the URL check above still covers the landing case.
  }
}

installStudioRecoveryCapture();
