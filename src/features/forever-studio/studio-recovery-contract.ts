/**
 * Forever Studio password recovery — the pure contract.
 *
 * Studio is invitation-only and deliberately has no sign-up path. Recovery
 * exists so an ALREADY INVITED account can replace a forgotten password; it
 * never creates an account and never grants Studio membership. Membership is
 * still resolved server-side on the next normal sign-in.
 *
 * Everything in this module is pure and free of Supabase, DOM and router
 * imports so the security-critical decisions — where the recovery link may
 * point, what counts as a recovery URL, and what makes a password acceptable
 * locally — can be tested directly and reused by both screens.
 *
 * Nothing here reads, stores, logs or returns a recovery token, a session, an
 * email address or a password value.
 */

/** The normal Studio sign-in surface. Recovery always ends back here. */
export const STUDIO_LOGIN_PATH = "/studio";

/** Public recovery-request screen. Outside the membership-protected boundary. */
export const STUDIO_FORGOT_PASSWORD_PATH = "/studio/forgot-password";

/**
 * The ONLY path a Supabase recovery link may return to.
 *
 * A fixed application constant on purpose: an attacker-supplied `redirectTo`
 * would turn the recovery mail into an open redirect that leaks the recovery
 * fragment to a foreign origin. This value is never derived from a query
 * parameter, form field, storage entry or remote content.
 */
export const STUDIO_RESET_PASSWORD_PATH = "/studio/reset-password";

/**
 * Minimum password length.
 *
 * This is the repository's existing Studio policy, already enforced when an
 * Owner invites a publisher (`inviteMember` in server/service.ts rejects
 * shorter than 10, and the invite field sets minLength={10}). Recovery reuses
 * it rather than inventing a second, inconsistent rule.
 *
 * Local validation is a courtesy that avoids a pointless round trip. The
 * Supabase server remains authoritative for final password acceptance.
 */
export const STUDIO_PASSWORD_MIN_LENGTH = 10;

/**
 * The single response the request screen is allowed to give.
 *
 * Identical for a known address, an unknown address, an unconfirmed account,
 * a disabled account and a non-member, so the form cannot be used to discover
 * whether an account exists or whether it can reach Studio.
 */
export const STUDIO_RECOVERY_GENERIC_NOTICE =
  "If an account exists for that email, a password reset link has been sent. Check the inbox and the spam folder.";

/** Shown after a successful password change, on the normal sign-in screen. */
export const STUDIO_PASSWORD_UPDATED_NOTICE = "Password updated. Sign in with the new password.";

/**
 * Shown when the password WAS changed but the recovery session could not be
 * proved closed. The password must not be submitted again; only sign-out is
 * retried. Until the session is confirmed gone the dashboard stays blocked,
 * because a surviving recovery session is exactly what would otherwise become a
 * working Studio session.
 */
export const STUDIO_SESSION_CLOSE_FAILED_NOTICE =
  "Your password was updated, but the recovery session could not be closed. Retry secure sign-out before continuing.";

/**
 * Deny-only marker recording that a recovery reached password-update but has
 * not been proved terminated. It survives a rerender, a route change and a
 * browser refresh so the fail-closed state cannot be escaped by reloading.
 *
 * It holds the literal "1" and nothing else — no token, no session, no email,
 * no user id, no password. It can only BLOCK access; it can never authorize a
 * password update, which requires the authoritative PASSWORD_RECOVERY event.
 * A forged marker therefore causes a harmless denial screen and nothing more.
 */
export const STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY = "forever.studio.recovery.incomplete";
export const STUDIO_RECOVERY_INCOMPLETE_MARKER_VALUE = "1";

/**
 * ORIGIN-WIDE deny-only marker — the cross-tab half of the guard.
 *
 * The Supabase session lives in localStorage under `sb-<ref>-auth-token`
 * (`persistSession: true`, `storage: localStorage` in the generated client), so
 * it is shared by every same-origin tab. A tab opened AFTER a recovery link was
 * consumed loads that session from storage and receives `INITIAL_SESSION` — not
 * `PASSWORD_RECOVERY`, which auth-js delivers only to tabs that already had a
 * client when the link was parsed. Without an origin-wide signal that second tab
 * sees an ordinary live session, reports `signed_in`, mounts the dashboard and
 * reaches `maybeBootstrapOwner` while the reset is still unfinished.
 *
 * `localStorage` is therefore correct HERE and nowhere else in recovery: this
 * key's only power is to REFUSE. It holds the literal "1" — no token, no
 * session, no email, no user id, no project reference, no timestamp, no
 * password, no recovery URL. A forged value produces a denial screen and
 * nothing more; it can never set `recoveryConfirmed`, show the password form or
 * authorize `updateUser`, all of which require the authoritative
 * `PASSWORD_RECOVERY` event in the tab that received it.
 *
 * Deliberately NOT written for a URL landing hint. `type=recovery` is
 * user-controlled text, and letting it write an origin-wide marker would turn
 * any link sent to the Owner into an origin-wide denial of Studio.
 */
export const STUDIO_RECOVERY_SHARED_DENY_KEY = "forever.studio.recovery.deny";
export const STUDIO_RECOVERY_SHARED_DENY_VALUE = "1";

/**
 * Storage key of the DEDICATED recovery Auth client.
 *
 * It must never equal the ordinary Studio client's key (`sb-<ref>-auth-token`),
 * for two independent reasons verified against the pinned
 * `@supabase/auth-js` 2.110.0:
 *
 *   - the auth-js `BroadcastChannel` is NAMED after the storage key
 *     (`new globalThis.BroadcastChannel(this.storageKey)`), so a shared key
 *     would put the recovery client back on the very channel that leaks
 *     `PASSWORD_RECOVERY` between tabs;
 *   - the persisted session slot is that key, so a shared key would put a
 *     recovery session into the ordinary shared session slot.
 *
 * In practice the recovery client also runs with `persistSession: false`, and
 * auth-js then ignores any supplied `storage` and installs its own memory
 * adapter AND skips channel construction entirely (both gated on
 * `this.persistSession`). This key is therefore belt-and-braces: nothing is
 * ever written under it.
 */
export const STUDIO_RECOVERY_CLIENT_STORAGE_KEY = "forever.studio.recovery.ephemeral";

/**
 * Same-lifetime companion signal to the storage key.
 *
 * `storage` events reach other tabs only when the write itself succeeded, so a
 * browser with localStorage disabled or full would silently lose cross-tab
 * denial. The channel carries the same two constant, non-sensitive verbs and
 * never a token, session, address or identifier.
 */
export const STUDIO_RECOVERY_SHARED_DENY_CHANNEL = "forever.studio.recovery.deny";
export const STUDIO_RECOVERY_SHARED_DENY_SIGNAL = "deny";
export const STUDIO_RECOVERY_SHARED_RELEASE_SIGNAL = "release";

/**
 * Third verb: "is anyone actually mid-recovery?".
 *
 * Needed because the recovery session now lives in the dedicated client's
 * MEMORY and never in shared localStorage. That isolation is the point of this
 * correction, but it also means every other tab's ordinary `getSession()`
 * truthfully resolves `null` during a live recovery — which is exactly the
 * condition the stale-marker self-heal treats as "nothing to protect". Without
 * a liveness question, the second tab would helpfully delete the origin-wide
 * denial the moment it was raised.
 *
 * A tab that holds live recovery answers by re-asserting `deny`. Silence means
 * no tab is recovering, so the marker really is stale. Both verbs are constant,
 * non-sensitive text; nothing identifying is ever asked or answered.
 */
export const STUDIO_RECOVERY_SHARED_PROBE_SIGNAL = "probe";

/**
 * How long to wait for an answer before treating the marker as abandoned.
 *
 * A same-origin BroadcastChannel round trip is sub-millisecond; this is
 * generous so a busy main thread cannot cause a live recovery to be unblocked.
 * The waiting tab shows the recovery interstitial throughout, so the delay is
 * never a window of access.
 */
export const STUDIO_RECOVERY_CLAIM_PROBE_MS = 400;

/**
 * Grace period after the auth client reports that it has finished starting up.
 *
 * Once start-up is done, a link that has not produced a recovery is not going
 * to produce one, so the verdict can be fast. The small grace only covers the
 * ordering of the initialisation events themselves.
 */
export const STUDIO_RECOVERY_SETTLED_GRACE_MS = 1200;

/**
 * Backstop for the case where the auth client never reports start-up at all
 * (offline, blocked, misconfigured). Deliberately generous: declaring a link
 * expired while it is still being parsed sends the publisher to request
 * another one for no reason, and the screen says "Checking the reset link…"
 * throughout, so waiting is honest rather than silent.
 */
export const STUDIO_RECOVERY_SETTLE_MS = 12000;

/**
 * Builds the recovery redirect from an origin and NOTHING else.
 *
 * The caller passes `window.location.origin`. Any query string, fragment,
 * path or credential in the supplied value is discarded by `new URL(path,
 * origin)`, so a hostile `?redirectTo=` on the request page cannot influence
 * the result. The assertions below are defence in depth: if the constructed
 * URL is ever not the exact fixed same-origin reset path, this throws instead
 * of mailing a link somewhere unintended.
 */
export function studioResetPasswordRedirectUrl(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("studio_recovery_redirect_origin_invalid");
  }
  if (
    parsed.protocol !== "https:" &&
    parsed.hostname !== "localhost" &&
    parsed.hostname !== "127.0.0.1"
  ) {
    throw new Error("studio_recovery_redirect_insecure_origin");
  }
  const url = new URL(STUDIO_RESET_PASSWORD_PATH, parsed.origin);
  if (url.origin !== parsed.origin || url.pathname !== STUDIO_RESET_PASSWORD_PATH) {
    throw new Error("studio_recovery_redirect_not_fixed_path");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new Error("studio_recovery_redirect_carries_state");
  }
  return url.toString();
}

/**
 * Whether a URL LOOKS LIKE a recovery landing — a NON-AUTHORITATIVE HINT.
 *
 * This is user-controlled text. Anyone can append `type=recovery` to a URL, so
 * this value must never authorize anything. Its only permitted effects are
 * defensive: hold the reset screen in "checking" so a slow auth start-up does
 * not produce a false "expired", and apply a deny-only dashboard guard while
 * authentication settles. Recovery AUTHORITY comes solely from the Supabase
 * `PASSWORD_RECOVERY` event (see `isStudioRecoveryConfirmed`).
 *
 * The hint is accepted only on the exact reset path. `type=recovery` appended
 * to `/studio`, `/studio/upload` or any other route means nothing at all.
 *
 * Reads ONLY the `type` parameter. The access token, refresh token and every
 * other fragment value are never read, returned or stored.
 */
export function urlIsStudioRecoveryLanding(
  pathname: string,
  hash: string,
  search: string,
): boolean {
  // Exact path only — trailing slash tolerated, nothing else.
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path !== STUDIO_RESET_PASSWORD_PATH) return false;

  const readType = (raw: string): string | null => {
    if (!raw) return null;
    const cleaned = raw.startsWith("#") || raw.startsWith("?") ? raw.slice(1) : raw;
    if (!cleaned) return null;
    try {
      return new URLSearchParams(cleaned).get("type");
    } catch {
      return null;
    }
  };
  return readType(hash) === "recovery" || readType(search) === "recovery";
}

export type StudioPasswordProblem = "empty" | "too_short" | "mismatch";

/**
 * Local password validation. Returns a PROBLEM CODE, never the password.
 *
 * `null` means "worth sending to the server", not "accepted" — Supabase may
 * still reject it under the project's own policy, and that rejection is
 * surfaced verbatim-free through `studioPasswordProblemMessage`.
 */
export function validateStudioPassword(
  password: string,
  confirmation: string,
): StudioPasswordProblem | null {
  if (password.length === 0) return "empty";
  if (password.length < STUDIO_PASSWORD_MIN_LENGTH) return "too_short";
  if (password !== confirmation) return "mismatch";
  return null;
}

/** Safe, non-echoing message for a local validation problem. */
export function studioPasswordProblemMessage(problem: StudioPasswordProblem): string {
  switch (problem) {
    case "empty":
      return "Enter a new password.";
    case "too_short":
      return `Use at least ${STUDIO_PASSWORD_MIN_LENGTH} characters.`;
    case "mismatch":
      return "The two passwords do not match.";
  }
}

/**
 * Maps a Supabase failure to a safe user message.
 *
 * Never returns the raw error: provider messages can carry the project
 * reference, a database detail or an enumeration hint. The password is never
 * part of any branch.
 */
export function studioRecoveryErrorMessage(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  const lowered = text.toLowerCase();
  if (lowered.includes("rate") || lowered.includes("too many") || lowered.includes("429")) {
    return "Too many attempts. Wait a few minutes and try again.";
  }
  if (
    lowered.includes("expired") ||
    lowered.includes("invalid") ||
    lowered.includes("not found") ||
    lowered.includes("jwt")
  ) {
    return "This reset link is no longer valid. Request a new one.";
  }
  if (lowered.includes("weak") || lowered.includes("password")) {
    return "That password was rejected. Choose a longer, less predictable one.";
  }
  if (lowered.includes("network") || lowered.includes("fetch") || lowered.includes("timeout")) {
    return "Could not reach the server. Check the connection and try again.";
  }
  return "Something went wrong. Try again.";
}

/** True when a request failure should be shown as rate limiting. */
export function isStudioRecoveryRateLimited(raw: unknown): boolean {
  const text = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  const lowered = text.toLowerCase();
  return lowered.includes("rate") || lowered.includes("too many") || lowered.includes("429");
}
