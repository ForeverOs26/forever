/**
 * Booth Mode 2.0 access gate — AUTHENTICATION AND AUTHORIZATION ONLY.
 *
 * Deployment enablement is no longer this component's concern. It moved to the
 * route's `beforeLoad` boundary (src/routes/booth-v2.tsx, PR #102 corrective
 * pass 3 item 2), because a React effect cannot produce a server-rendered
 * not-found response: while the pilot is disabled the route never matches past
 * the root not-found boundary, so this component is never rendered, never
 * mounted, and never asks the browser anything. That is what makes the disabled
 * route genuinely equivalent to a missing one instead of a page that hides
 * itself after announcing it exists.
 *
 * What remains here, once the server has already confirmed the pilot is
 * enabled:
 *
 *   1. a visitor without a Supabase session sees the staff sign-in form;
 *   2. a signed-in caller is checked against the same gated endpoint every
 *      other Booth call uses — active staff membership AND the explicit Booth
 *      capability, with enablement re-checked there too. Any refusal renders
 *      the same not-found boundary, so a signed-in account without the
 *      capability cannot tell the pilot exists.
 *
 * Every step fails closed: a network error, a thrown probe or an unexpected
 * shape all land on the not-found boundary. This gate is presentation only —
 * every operational endpoint is independently gated on the server, and the
 * browser's own credential is attached and re-verified per call.
 */

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { NotFoundComponent } from "@/routes/__root";

import { boothV2GetAccess } from "./booth-v2.functions";
import { BoothV2Navigator } from "./BoothV2Navigator";

type GateState =
  | { status: "checking" }
  | { status: "granted"; hostName: string | null }
  | { status: "signed_out" }
  | { status: "denied" };

export function BoothV2Gate() {
  const [state, setState] = useState<GateState>({ status: "checking" });

  useEffect(() => {
    let active = true;
    async function check() {
      // 1. A signed-out visitor may sign in. (The route already proved, on the
      //    server, that this deployment enabled the pilot at all.)
      let signedIn = false;
      try {
        const { data } = await supabase.auth.getSession();
        signedIn = Boolean(data.session);
      } catch {
        signedIn = false;
      }
      if (!active) return;
      if (!signedIn) {
        setState({ status: "signed_out" });
        return;
      }

      // 2. Signed in: the server decides, opaquely. The gated call carries the
      //    Host's own access token and the server re-verifies it.
      try {
        const access = await boothV2GetAccess();
        if (!active) return;
        setState({ status: "granted", hostName: access.hostName });
      } catch {
        if (!active) return;
        // Non-member, disabled membership, missing Booth capability, a pilot
        // switched off since the route loaded, or any other refusal — all
        // indistinguishable, all fail closed.
        setState({ status: "denied" });
      }
    }
    void check();
    const { data: subscription } = supabase.auth.onAuthStateChange(() => {
      setState({ status: "checking" });
      void check();
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  if (state.status === "checking") {
    return <p className="py-24 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (state.status === "signed_out") return <BoothStaffLogin />;
  if (state.status === "denied") return <NotFoundComponent />;
  return <BoothV2Navigator hostName={state.hostName} />;
}

/**
 * Staff sign-in only. There is no sign-up path: accounts come from the
 * existing Forever staff roster, and a validly signed-in account without an
 * active membership is still refused by the server boundary.
 */
function BoothStaffLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (signInError) setError("Sign-in failed. Check the email and password.");
  };

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">Forever Booth</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Staff sign-in. The booth cannot be operated without an authorized Forever account.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="booth-email">Email</Label>
          <Input
            id="booth-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="booth-password">Password</Label>
          <Input
            id="booth-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" className="h-12 w-full text-base" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
