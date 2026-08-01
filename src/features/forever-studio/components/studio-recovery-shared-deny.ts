/**
 * The origin-wide, deny-only half of the recovery guard.
 *
 * WHY THIS EXISTS. The Supabase browser session is persisted in localStorage and
 * is therefore shared by every same-origin tab. Verified against the pinned
 * `@supabase/auth-js` 2.110.0:
 *
 *   - the session is stored under `sb-<ref>-auth-token` in localStorage
 *     (`SupabaseClient` default storage key; this app also passes
 *     `storage: localStorage, persistSession: true` explicitly);
 *   - `PASSWORD_RECOVERY` is emitted by `_notifyAllSubscribers(..., broadcast =
 *     true)` and so reaches tabs that ALREADY hold a client, over a
 *     `BroadcastChannel` named after the storage key;
 *   - a tab opened afterwards never sees it. `_emitInitialSession` delivers
 *     `INITIAL_SESSION` to that one new subscriber only, carrying the live
 *     recovery session recovered from shared storage.
 *
 * So the previous guard — an in-memory boolean plus a sessionStorage marker,
 * both tab-local — protected the recovery tab and left a second tab holding an
 * ordinary-looking `signed_in` session that would mount the dashboard and reach
 * `maybeBootstrapOwner`.
 *
 * WHAT THIS IS. A single constant, "1", under one localStorage key, mirrored by
 * a two-verb BroadcastChannel. Its ONLY power is refusal. It can never confirm
 * recovery, reveal the password form or authorize `updateUser`; those still
 * require the authoritative `PASSWORD_RECOVERY` event in the tab that received
 * it. A forged marker therefore costs an attacker a denial screen and buys
 * nothing.
 *
 * WHAT IS NEVER STORED OR SENT HERE. Access token, refresh token, recovery
 * token, session object, email address, user id, project reference, password,
 * recovery URL, or any timestamp tied to an identity.
 */

import {
  STUDIO_RECOVERY_CLAIM_PROBE_MS,
  STUDIO_RECOVERY_SHARED_DENY_CHANNEL,
  STUDIO_RECOVERY_SHARED_DENY_KEY,
  STUDIO_RECOVERY_SHARED_DENY_SIGNAL,
  STUDIO_RECOVERY_SHARED_DENY_VALUE,
  STUDIO_RECOVERY_SHARED_PROBE_SIGNAL,
  STUDIO_RECOVERY_SHARED_RELEASE_SIGNAL,
} from "../studio-recovery-contract";

type DenyListener = () => void;

const listeners = new Set<DenyListener>();

/**
 * True while THIS tab is the live recovery — it holds local authority, or it
 * updated the password and has not yet proved sign-out.
 *
 * Its only use is to answer a `probe` from a tab that is about to conclude the
 * marker is abandoned. It is never consulted to grant anything.
 */
let claimHeld = false;
/** Set when any `deny` arrives, including an answer to our own probe. */
let claimAnswered = false;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * This tab has already asked during the CURRENT denial.
 *
 * Without it the guard live-locks: the answer to a probe is a `deny`, a `deny`
 * notifies every tab, a notification re-runs the session refresh, and a refresh
 * that finds no session asks again. One question per denial terminates. The
 * epoch resets whenever the denial is actually lifted, so a later, genuinely
 * abandoned marker is still challenged — as is any marker seen after a reload.
 */
let probedThisDenial = false;

export function holdStudioRecoveryClaim(): void {
  claimHeld = true;
}

export function releaseStudioRecoveryClaim(): void {
  claimHeld = false;
}

export function isStudioRecoveryClaimHeld(): boolean {
  return claimHeld;
}

/**
 * Deny latched in this page's memory.
 *
 * Needed because a denial can arrive over the channel in a browser where the
 * storage write failed (disabled, full, partitioned). Reading storage alone
 * would then forget the denial the moment the notification returned.
 */
let latchedDeny = false;
let channel: BroadcastChannel | null = null;
let installed = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function readStorage(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(STUDIO_RECOVERY_SHARED_DENY_KEY) === STUDIO_RECOVERY_SHARED_DENY_VALUE
    );
  } catch {
    // Storage unavailable is NOT evidence of absence. The in-memory latch below
    // still answers for this page, and nothing here ever unblocks.
    return false;
  }
}

/**
 * The CURRENT origin-wide denial, re-read on every call.
 *
 * Never memoised at module initialisation: another tab can write the marker at
 * any moment, and a value captured once would leave this tab reporting
 * `signed_in` for the rest of its life.
 */
export function isStudioRecoverySharedDenyActive(): boolean {
  return latchedDeny || readStorage();
}

function post(signal: string): void {
  try {
    channel?.postMessage({ signal });
  } catch {
    // A closed or unavailable channel must not break the guard. The storage
    // key and the local latch both still stand.
  }
}

/**
 * Establishes the origin-wide denial.
 *
 * Called the instant an authoritative `PASSWORD_RECOVERY` event is observed —
 * not after the password is updated, and not when sign-out begins. The
 * dangerous shared session exists from the moment the link is consumed, so
 * every other tab has to be refused from that same moment.
 */
export function setStudioRecoverySharedDeny(): void {
  installStudioRecoverySharedDeny();
  latchedDeny = true;
  try {
    localStorage.setItem(STUDIO_RECOVERY_SHARED_DENY_KEY, STUDIO_RECOVERY_SHARED_DENY_VALUE);
  } catch {
    // Cross-tab synchronisation cannot be guaranteed by storage in this browser
    // condition. The channel below is the same-lifetime fallback; this tab
    // remains blocked either way. Nothing is stored anywhere else.
  }
  post(STUDIO_RECOVERY_SHARED_DENY_SIGNAL);
  emit();
}

/**
 * Releases the origin-wide denial.
 *
 * ONLY legitimate once the recovery session has been positively confirmed
 * absent — a `getSession()` that RESOLVED with `null`. A rejected call, a
 * timeout, a network failure or an unreadable storage is not absence, and must
 * leave the marker exactly where it is.
 */
export function clearStudioRecoverySharedDeny(): void {
  installStudioRecoverySharedDeny();
  latchedDeny = false;
  // The denial is over; a future one deserves a fresh question.
  probedThisDenial = false;
  try {
    localStorage.removeItem(STUDIO_RECOVERY_SHARED_DENY_KEY);
  } catch {
    // Nothing further to do; the latch is already cleared for this page.
  }
  post(STUDIO_RECOVERY_SHARED_RELEASE_SIGNAL);
  emit();
}

/**
 * Releases the origin-wide denial ONLY if no tab claims a live recovery.
 *
 * The caller has already established positive absence of every session IT can
 * see. That is no longer sufficient on its own: the recovery session lives in
 * another tab's memory by design, so "I can see no session" is the normal state
 * of every non-recovering tab during a perfectly healthy reset. So ask, wait,
 * and clear only on silence.
 *
 * Fails closed in every direction: a probe that is never answered because the
 * channel is unavailable still leaves the marker in place until the timer runs,
 * and any `deny` heard in the meantime cancels the release outright.
 */
export function releaseStudioRecoverySharedDenyIfUnclaimed(): void {
  installStudioRecoverySharedDeny();
  if (claimHeld) return;
  if (!isStudioRecoverySharedDenyActive()) return;
  if (probeTimer !== null || probedThisDenial) return;

  probedThisDenial = true;
  claimAnswered = false;
  post(STUDIO_RECOVERY_SHARED_PROBE_SIGNAL);

  probeTimer = setTimeout(() => {
    probeTimer = null;
    // A live recovery answered, or one started while we waited.
    if (claimAnswered || claimHeld) return;
    if (!isStudioRecoverySharedDenyActive()) return;
    clearStudioRecoverySharedDeny();
  }, STUDIO_RECOVERY_CLAIM_PROBE_MS);
}

export function subscribeStudioRecoverySharedDeny(listener: DenyListener): () => void {
  installStudioRecoverySharedDeny();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Wires the two cross-tab notification sources.
 *
 * `storage` fires in the OTHER tabs of the origin when the key changes, and the
 * channel covers the case where the write never landed. Both are notifications
 * only: they cause a re-read, they are not themselves trusted as authority.
 */
export function installStudioRecoverySharedDeny(): void {
  if (installed) return;
  installed = true;

  if (typeof window === "undefined") return;

  try {
    window.addEventListener("storage", (event: StorageEvent) => {
      if (event.key !== null && event.key !== STUDIO_RECOVERY_SHARED_DENY_KEY) return;
      // A deny observed in storage is latched, so it survives a later storage
      // failure. A removal is NOT latched away here: only positive session
      // absence may release, and the tab that proved it also posts `release`.
      if (event.newValue === STUDIO_RECOVERY_SHARED_DENY_VALUE) latchedDeny = true;
      emit();
    });
  } catch {
    // No storage events in this environment; the channel remains.
  }

  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(STUDIO_RECOVERY_SHARED_DENY_CHANNEL);
      channel.addEventListener("message", (event: MessageEvent) => {
        const signal = (event.data as { signal?: unknown } | null)?.signal;
        if (signal === STUDIO_RECOVERY_SHARED_PROBE_SIGNAL) {
          // Someone is about to decide the marker is abandoned. If this tab IS
          // the recovery, say so by re-asserting the denial — which also
          // rewrites the marker, healing a storage write that never landed.
          if (claimHeld) setStudioRecoverySharedDeny();
          return;
        }
        if (signal === STUDIO_RECOVERY_SHARED_DENY_SIGNAL) {
          latchedDeny = true;
          // Cancels any release this tab was about to perform.
          claimAnswered = true;
        } else if (signal === STUDIO_RECOVERY_SHARED_RELEASE_SIGNAL) {
          latchedDeny = false;
          probedThisDenial = false;
        } else return;
        emit();
      });
    }
  } catch {
    // No channel in this environment; the storage key remains.
  }
}
