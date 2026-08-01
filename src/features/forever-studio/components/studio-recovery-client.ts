/**
 * The DEDICATED recovery Auth client — the only thing allowed to consume a
 * recovery link, and the only source of password-reset authority.
 *
 * WHY A SECOND CLIENT EXISTS AT ALL
 *
 * `onAuthStateChange` reports an event NAME and a session. It does not say
 * whether the event was produced by this tab or arrived from another one, and
 * with the pinned `@supabase/auth-js` 2.110.0 both are possible on the ordinary
 * client:
 *
 *   `_getSessionFromURL()` → `_notifyAllSubscribers('PASSWORD_RECOVERY', s)`
 *   → (broadcast = true) → `broadcastChannel.postMessage({event, session})`
 *   → every OTHER same-origin tab → `_notifyAllSubscribers(event, session, false)`
 *   → that tab's `onAuthStateChange` callback, identical in every respect.
 *
 * So "I saw PASSWORD_RECOVERY" is NOT evidence that this tab consumed a link.
 * It is evidence that SOME tab of this origin did. That is enough to DENY
 * Studio everywhere; it is not enough to hand out a password form.
 *
 * WHAT MAKES THIS CLIENT'S EVENT DIFFERENT
 *
 * Two gates in the auth-js constructor, both keyed on `persistSession`:
 *
 *   if (this.persistSession) { ...use settings.storage / localStorage... }
 *   else { this.memoryStorage = {};
 *          this.storage = memoryLocalStorageAdapter(this.memoryStorage) }
 *
 *   if (isBrowser() && globalThis.BroadcastChannel
 *       && this.persistSession && this.storageKey) { ...create channel... }
 *
 * With `persistSession: false` the library itself guarantees, without any
 * cooperation from this file, that:
 *
 *   - the session is held in memory and CANNOT reach localStorage — so it never
 *     enters the ordinary shared `sb-<ref>-auth-token` slot, and no other tab
 *     can read it;
 *   - NO BroadcastChannel is constructed — so this client can neither send a
 *     `PASSWORD_RECOVERY` to other tabs nor receive one from them.
 *
 * A `PASSWORD_RECOVERY` observed on THIS client therefore has exactly one
 * possible origin: its own `_getSessionFromURL()`, run against this tab's own
 * `window.location`, with a token the server accepted. That is a local,
 * non-forgeable proof of link consumption, and it is the only thing this
 * feature treats as reset authority.
 *
 * WHAT IS NEVER DONE HERE. The access token, refresh token and URL fragment are
 * never read, copied, logged or stored by this module; auth-js parses them and
 * keeps the resulting session in its own memory. Nothing is written to
 * localStorage, sessionStorage, a cookie or a channel.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { STUDIO_RECOVERY_CLIENT_STORAGE_KEY } from "../studio-recovery-contract";

/** Mirrors the generated client: new-style keys are opaque, not bearer JWTs. */
function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createRecoveryFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function readEnv(viteKey: string, nodeKey: string): string | undefined {
  const fromVite = (import.meta.env as Record<string, string | undefined>)[viteKey];
  if (fromVite) return fromVite;
  // `process` is not defined in every browser build; never let that throw.
  if (typeof process !== "undefined" && process.env) return process.env[nodeKey];
  return undefined;
}

let client: SupabaseClient | null = null;

/**
 * Creates the recovery client ON DEMAND, and only on the reset screen.
 *
 * Deliberately lazy. Route modules are statically imported by the generated
 * route tree, so a module-scope client would be constructed on every page of
 * the site. Laziness is also SAFE here precisely because the ordinary client
 * runs with `detectSessionInUrl: false`: nothing else in the app parses or
 * clears `window.location.hash`, so the fragment is still intact whenever this
 * client is finally constructed.
 *
 * Returns `null` rather than throwing when there is no browser or no
 * configuration — no client means no authority, which is the fail-closed
 * outcome.
 */
export function getStudioRecoveryClient(): SupabaseClient | null {
  if (client) return client;
  if (typeof window === "undefined") return null;

  const url = readEnv("VITE_SUPABASE_URL", "SUPABASE_URL");
  const key = readEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) return null;

  try {
    client = createClient(url, key, {
      global: { fetch: createRecoveryFetch(key) },
      auth: {
        // THE isolation switch. Memory-only session, and no BroadcastChannel.
        persistSession: false,
        // Never the ordinary `sb-<ref>-auth-token`. Nothing is written under
        // it, but a shared key would name a shared channel.
        storageKey: STUDIO_RECOVERY_CLIENT_STORAGE_KEY,
        // THIS client, and only this client, consumes the recovery link.
        detectSessionInUrl: true,
        // A recovery session is short-lived by design and is terminated as soon
        // as the password is saved. Nothing should silently extend it.
        autoRefreshToken: false,
        // The pinned project's existing flow: Supabase recovery links carry the
        // tokens in the URL fragment. `implicit` is also the auth-js default.
        flowType: "implicit",
      },
    });
  } catch {
    // A client that cannot be constructed grants nothing.
    return null;
  }
  return client;
}

/** True once the dedicated client exists. Used by tests and the storage audit. */
export function studioRecoveryClientExists(): boolean {
  return client !== null;
}

/**
 * Drops the dedicated client after a completed reset.
 *
 * The session it held lived in auth-js's own memory, so releasing the reference
 * is what discards it. Called only once termination has been positively proved.
 */
export function discardStudioRecoveryClient(): void {
  client = null;
}
