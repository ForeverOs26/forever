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
  // The DENY-ONLY guard wins over any session that exists. It is deliberately
  // broader than recovery authority — a landing hint or an unterminated
  // recovery is enough to withhold the dashboard, because withholding is
  // always safe. Notably this also covers the fail-closed case where a
  // password was updated but the recovery session could not be proved closed.
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
      void supabase.auth.getSession().then(({ data }) => {
        if (!mounted) return;
        setState(resolveState(data.session as SessionLike));
      });
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
