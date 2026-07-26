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
 *
 * THE AUTH-EVENT LIFECYCLE (PR #102 corrective pass 4).
 *
 * What was wrong: the `onAuthStateChange` subscriber re-ran the whole check,
 * and that check opened with `supabase.auth.getSession()`. Supabase-js holds an
 * internal lock while it emits an auth event and awaits its subscribers, so
 * calling any Supabase API from inside that callback — directly or through a
 * Booth server function, whose client middleware calls `getSession()` to attach
 * the Host's token — can deadlock the shared client. On a booth tablet that is
 * not a theoretical window: SIGNED_IN, TOKEN_REFRESHED on an idle tablet,
 * SIGNED_OUT followed by a rapid re-login all land in it, and the symptom is a
 * page stuck on "Loading…" with every later Supabase call hanging behind it.
 *
 * What replaces it: the work is split in two.
 *
 *   • INITIAL SESSION DISCOVERY runs once on mount. It may call `getSession()`
 *     because it is not inside an auth callback.
 *   • THE AUTHORIZED-ACCESS PROBE — the gated `boothV2GetAccess` call — never
 *     runs inside the callback stack. The subscriber reads the session object
 *     Supabase hands it, decides synchronously, and hands the probe to a fresh
 *     macrotask via `setTimeout(…, 0)`, the documented workaround. By the time
 *     it runs the callback has long returned and the lock is released.
 *
 * Around that sit three invariants, all proven in booth-auth-lifecycle.test.tsx:
 * a monotonic generation counter, so a probe whose auth state has since changed
 * can never apply its result; a per-identity guard, so repeated SIGNED_IN and
 * TOKEN_REFRESHED events for the same Host do not restart the probe (a token
 * rotating on a timer would otherwise probe the server forever); and unmount
 * cancellation that also clears the scheduled timers.
 *
 * The credential transport is untouched: `boothV2GetAccess` still travels
 * through `requireBoothStaff`, which attaches the Host's own access token and
 * has the server re-verify it. Deferring the call changes WHEN it is made, not
 * what it proves.
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

/**
 * The only part of a Supabase session this gate reads. Deliberately structural
 * rather than the imported `Session` type: the gate must keep working when
 * Supabase hands the callback something unexpected, and a null-ish session is
 * simply "signed out".
 */
type ObservedSession = { user?: { id?: string | null } | null } | null | undefined;

/**
 * A session that exists but carries no readable user id. It still counts as
 * signed in — the server, not this component, decides who may operate the booth
 * — but it collapses to one identity so it cannot drive a repeated probe.
 */
const UNIDENTIFIED_SESSION = "session-without-user-id";

/**
 * The key the access probe is deduplicated on: `null` when there is no session,
 * otherwise the signed-in user. NOT the access token — the token rotates on
 * every TOKEN_REFRESHED, and keying on it would re-probe the gated endpoint for
 * as long as a tablet stays signed in.
 */
function observedIdentity(session: ObservedSession): string | null {
  if (!session) return null;
  const id = session.user?.id;
  return typeof id === "string" && id.length > 0 ? id : UNIDENTIFIED_SESSION;
}

export function BoothV2Gate() {
  const [state, setState] = useState<GateState>({ status: "checking" });

  useEffect(() => {
    let active = true;
    /**
     * Bumped by every auth observation that changes the answer. A probe applies
     * its result only while its own generation is still current, so a result
     * that was already in flight when the Host signed out — or signed in as
     * somebody else — is discarded instead of overwriting the newer state.
     */
    let generation = 0;
    /**
     * The last identity this gate acted on. `undefined` means nothing has been
     * observed yet, which is deliberately distinct from `null` — "observed, and
     * there is no session".
     */
    let observed: string | null | undefined = undefined;
    /** Deferred probes, so unmount can cancel one that has not fired yet. */
    const scheduled = new Set<ReturnType<typeof setTimeout>>();

    /**
     * The gated access probe. It reaches the server and, through the Booth
     * client middleware, Supabase — so it must never run inside an auth
     * callback. Every caller below either is already outside one or defers.
     */
    async function probeAccess(forGeneration: number) {
      try {
        const access = await boothV2GetAccess();
        if (!active || forGeneration !== generation) return;
        setState({ status: "granted", hostName: access.hostName });
      } catch {
        if (!active || forGeneration !== generation) return;
        // Non-member, disabled membership, missing Booth capability, a pilot
        // switched off since the route loaded, or any other refusal — all
        // indistinguishable, all fail closed.
        setState({ status: "denied" });
      }
    }

    /**
     * Hand the probe to a fresh macrotask. `setTimeout(…, 0)` rather than
     * `queueMicrotask`: a microtask can still run while Supabase is unwinding
     * the emit that invoked us, which is precisely the re-entrancy being fixed.
     */
    function deferProbe(forGeneration: number) {
      const timer = setTimeout(() => {
        scheduled.delete(timer);
        if (!active || forGeneration !== generation) return;
        void probeAccess(forGeneration);
      }, 0);
      scheduled.add(timer);
    }

    /**
     * Decide from an observed session. SYNCHRONOUS AND SUPABASE-FREE — this is
     * the whole body of the auth callback, so nothing it does may touch the
     * Supabase client.
     */
    function applyObservedSession(session: ObservedSession, defer: boolean) {
      const identity = observedIdentity(session);

      // Supabase emits INITIAL_SESSION on subscribe, re-emits SIGNED_IN, and
      // emits TOKEN_REFRESHED every time the token rotates. The same identity
      // is the same decision: leave the settled state alone rather than
      // flickering back through "checking" and re-probing the server on a
      // timer for as long as the tablet stays signed in.
      if (identity === observed) return;

      // A real transition. Anything already in flight, or still pending, was
      // decided for the previous identity and must not apply its result —
      // signing out therefore invalidates an unfinished access probe.
      generation += 1;
      observed = identity;

      if (identity === null) {
        setState({ status: "signed_out" });
        return;
      }
      setState({ status: "checking" });
      if (defer) deferProbe(generation);
      else void probeAccess(generation);
    }

    // 1. INITIAL SESSION DISCOVERY. A Supabase call is safe here: this runs on
    //    mount, not inside an auth callback. (The route already proved, on the
    //    server, that this deployment enabled the pilot at all.)
    void (async () => {
      let session: ObservedSession = null;
      try {
        const { data } = await supabase.auth.getSession();
        session = (data?.session ?? null) as ObservedSession;
      } catch {
        // Unreadable storage or an unconfigured client: treated as signed out.
        session = null;
      }
      if (!active) return;
      // Supabase emits INITIAL_SESSION on subscribe, and an auth transition may
      // have arrived while this read was in flight. The newer observation wins.
      if (generation !== 0) return;
      applyObservedSession(session, false);
    })();

    // 2. AUTH TRANSITIONS. The callback uses the session Supabase supplies and
    //    calls nothing — no getSession, getUser, refreshSession, signIn,
    //    signOut, and no Booth server function. The probe is deferred out of
    //    this stack entirely.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      applyObservedSession(session as ObservedSession, true);
    });

    return () => {
      active = false;
      for (const timer of scheduled) clearTimeout(timer);
      scheduled.clear();
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
