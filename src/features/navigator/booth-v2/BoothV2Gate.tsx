/**
 * Booth Mode 2.0 access gate.
 *
 * `noindex` is not access control, so nothing about the pilot renders until the
 * SERVER has spoken. The order is deliberate and is what makes the
 * default-disabled route TRUTHFUL (PR #102 corrective item 9):
 *
 *   1. ask the server whether this deployment has enabled the pilot at all.
 *      While it has not, /booth-v2 renders the application's ordinary
 *      not-found boundary for EVERY visitor — including a signed-out one. A
 *      disabled deployment therefore never shows a Forever Booth login form,
 *      and the page is indistinguishable from a URL that does not exist;
 *   2. only once the pilot is known to be enabled does a visitor without a
 *      Supabase session see the staff sign-in form;
 *   3. a signed-in caller is then checked against the same gated endpoint every
 *      other Booth call uses — active staff membership AND the explicit Booth
 *      capability. Any refusal renders the same not-found boundary, so a
 *      signed-in account without the capability cannot tell the pilot exists.
 *
 * Every step fails closed: a network error, a thrown probe or an unexpected
 * shape all land on the not-found boundary. This gate is presentation only —
 * every operational endpoint is independently gated on the server.
 */

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { NotFoundComponent } from "@/routes/__root";

import { boothV2GetAccess, boothV2GetRouteAvailability } from "./booth-v2.functions";
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
      // 1. Deployment enablement FIRST — before any sign-in surface exists.
      try {
        const availability = await boothV2GetRouteAvailability();
        if (!active) return;
        if (availability?.available !== true) {
          setState({ status: "denied" });
          return;
        }
      } catch {
        if (!active) return;
        setState({ status: "denied" });
        return;
      }

      // 2. The pilot is enabled: a signed-out visitor may sign in.
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (!data.session) {
        setState({ status: "signed_out" });
        return;
      }

      // 3. Signed in: the server decides, opaquely.
      try {
        const access = await boothV2GetAccess();
        if (!active) return;
        setState({ status: "granted", hostName: access.hostName });
      } catch {
        if (!active) return;
        // Non-member, disabled membership, missing Booth capability, or any
        // other refusal — all indistinguishable, all fail closed.
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
