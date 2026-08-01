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
  isStudioRecoveryMode,
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
  // Recovery wins over any session that exists: the only thing this visitor
  // may do is finish setting a password.
  if (isStudioRecoveryMode()) return { status: "recovery" };
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

export async function studioSignOut(): Promise<void> {
  clearStudioRecoveryMode();
  await supabase.auth.signOut();
}
