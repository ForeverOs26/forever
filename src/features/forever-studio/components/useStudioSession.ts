/**
 * Browser session state for Forever Studio.
 *
 * Presentation only: a session here merely unlocks the UI shell. Every
 * Studio operation is re-authorized server-side (JWT + active membership),
 * so nothing in this hook grants access to anything.
 *
 * One distinction is security-relevant. A Supabase recovery link produces a
 * real session, and treating it as a normal sign-in would drop the visitor
 * into the dashboard — which calls Studio server functions, which run
 * `resolveStudioActor` → `maybeBootstrapOwner`. A half-finished password reset
 * would then mint the Owner membership. So a recovery session reports its own
 * `recovery` status and never `signed_in`, and the Studio layout refuses to
 * mount the dashboard while it is active.
 */

import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

import {
  clearStudioRecoveryMode,
  installStudioRecoveryCapture,
  isStudioRecoveryBlocked,
  noteStudioSessionPositivelyAbsent,
  subscribeStudioRecoveryMode,
} from "./studio-recovery-mode";

// Module scope on purpose: the PASSWORD_RECOVERY event can be emitted during
// Supabase client start-up, before any component mounts.
installStudioRecoveryCapture();

export type StudioSessionState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "recovery" }
  | { status: "signed_in"; userId: string; email: string | null };

type SessionLike = { user: { id: string; email?: string | null } } | null;

function resolveState(session: SessionLike): StudioSessionState {
  // The DENY-ONLY guard wins over any session that exists, and is re-read here
  // on EVERY resolution — every auth event, every getSession settle, every
  // route change, every cross-tab notification. It is deliberately broader than
  // recovery authority: a landing hint, an unterminated recovery, or a recovery
  // running in another tab of this origin is each enough to withhold the
  // dashboard, because withholding is always safe. That last term is what stops
  // a tab opened after the recovery link — which auth-js hands an
  // `INITIAL_SESSION` carrying the live shared recovery session, never a
  // `PASSWORD_RECOVERY` — from reporting `signed_in`.
  if (isStudioRecoveryBlocked()) return { status: "recovery" };
  return session
    ? { status: "signed_in", userId: session.user.id, email: session.user.email ?? null }
    : { status: "signed_out" };
}

export function useStudioSession(): StudioSessionState {
  const [state, setState] = useState<StudioSessionState>({ status: "loading" });

  useEffect(() => {
    let mounted = true;

    const refresh = () => {
      // `getSession()` can also throw SYNCHRONOUSLY — a misconfigured client
      // constructed lazily on this very access, for one. Letting that escape
      // would tear down the effect and leave the hook stuck on `loading`, which
      // renders nothing and so proves nothing about the guard.
      let pending: ReturnType<typeof supabase.auth.getSession>;
      try {
        pending = supabase.auth.getSession();
      } catch {
        // Not absence. Nothing is healed and nothing is unblocked.
        if (mounted) setState(resolveState(null));
        return;
      }
      void pending.then(
        ({ data }) => {
          if (!mounted) return;
          const session = data.session as SessionLike;
          // POSITIVE ABSENCE — the call resolved and there is no session. Only
          // here may a marker left behind by a crashed or closed recovery tab
          // be healed, so the Owner is not locked out of an origin where no
          // Auth session exists at all.
          if (!session) noteStudioSessionPositivelyAbsent();
          setState(resolveState(session));
        },
        () => {
          // REJECTED — a thrown error, a timeout, an offline network. This is
          // not absence and proves nothing, so it heals nothing and unblocks
          // nothing; `resolveState` still consults the live guard, which
          // answers `recovery` whenever a marker stands.
          if (!mounted) return;
          setState(resolveState(null));
        },
      );
    };

    refresh();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setState(resolveState(session as SessionLike));
    });

    const unsubscribeRecovery = subscribeStudioRecoveryMode(() => {
      if (!mounted) return;
      refresh();
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
      unsubscribeRecovery();
    };
  }, []);

  return state;
}

/**
 * Ordinary Studio sign-out, from the shell.
 *
 * Sign out FIRST, then drop recovery state — never the other way round, so a
 * failed sign-out cannot leave a live session with the guard already lifted.
 * The incomplete-termination marker is deliberately NOT cleared here: only the
 * reset screen may clear it, and only after confirming the session is gone.
 */
export async function studioSignOut(): Promise<void> {
  await supabase.auth.signOut();
  clearStudioRecoveryMode();
}
