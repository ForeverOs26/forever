/**
 * Browser session state for Forever Studio.
 *
 * Presentation only: a session here merely unlocks the UI shell. Every
 * Studio operation is re-authorized server-side (JWT + active membership),
 * so nothing in this hook grants access to anything.
 */

import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

export type StudioSessionState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signed_in"; email: string | null };

export function useStudioSession(): StudioSessionState {
  const [state, setState] = useState<StudioSessionState>({ status: "loading" });

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setState(
        data.session
          ? { status: "signed_in", email: data.session.user.email ?? null }
          : { status: "signed_out" },
      );
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(
        session
          ? { status: "signed_in", email: session.user.email ?? null }
          : { status: "signed_out" },
      );
    });
    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return state;
}

export async function studioSignOut(): Promise<void> {
  await supabase.auth.signOut();
}
