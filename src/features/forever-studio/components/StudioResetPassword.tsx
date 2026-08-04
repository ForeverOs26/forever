/**
 * Forever Studio new-password screen — the landing target of a recovery link.
 *
 * It lives OUTSIDE the membership-protected Studio boundary on purpose: a
 * publisher who cannot sign in must be able to complete a reset, and requiring
 * a Studio membership here would deadlock the Owner before bootstrap has ever
 * run. It therefore loads no dashboard data and calls no Studio server
 * function.
 *
 * Two properties matter more than anything else on this screen.
 *
 * AUTHORITY. The form becomes usable only when Supabase itself reported
 * `PASSWORD_RECOVERY` and a live session exists. A URL that merely says
 * `type=recovery` is user-controlled text: it can hold the screen in "checking"
 * and it can withhold the dashboard, but it can never authorize `updateUser`.
 *
 * TERMINATION FAILS CLOSED. A recovery session is a real Supabase session, so
 * one that survives the reset would become a working Studio session — and the
 * dashboard runs `resolveStudioActor` → `maybeBootstrapOwner`. Sign-out is
 * therefore not fire-and-forget: the returned error, any thrown exception, and
 * a follow-up `getSession()` are all inspected, and recovery protection is
 * dropped only once the session is positively confirmed absent. Until then the
 * screen stays on a retry state that never resubmits the password.
 *
 * The recovery token is never read, copied, stored or logged, and the password
 * is cleared from state the instant the update succeeds.
 */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { beginConsequentialAction } from "@/lib/stale-asset/write-safety";
import { supabase } from "@/integrations/supabase/client";

import {
  STUDIO_FORGOT_PASSWORD_PATH,
  STUDIO_LOGIN_PATH,
  STUDIO_PASSWORD_MIN_LENGTH,
  STUDIO_RECOVERY_SETTLE_MS,
  STUDIO_RECOVERY_SETTLED_GRACE_MS,
  STUDIO_SESSION_CLOSE_FAILED_NOTICE,
  studioPasswordProblemMessage,
  studioRecoveryErrorMessage,
  validateStudioPassword,
} from "../studio-recovery-contract";
import { discardStudioRecoveryClient, getStudioRecoveryClient } from "./studio-recovery-client";
import {
  clearStudioRecoveryIncompleteTermination,
  clearStudioRecoveryMode,
  clearStudioRecoverySharedBlock,
  installStudioRecoveryAuthority,
  installStudioRecoveryCapture,
  isStudioAuthSettled,
  isStudioLocalRecoveryAuthority,
  isStudioRecoveryTerminationIncomplete,
  markStudioRecoveryIncompleteTermination,
  setStudioPasswordUpdatedNotice,
  subscribeStudioAuthSettled,
  subscribeStudioRecoveryMode,
} from "./studio-recovery-mode";

// The event may already have fired before this module's component mounts.
installStudioRecoveryCapture();

type AuthCapableClient = {
  auth: {
    getSession: () => Promise<{ data: { session: unknown } }>;
    signOut: (options?: { scope: "local" }) => Promise<{ error: unknown }>;
  };
};

/**
 * Global sign-out, falling back to the supported local scope.
 *
 * Global also revokes the refresh token server-side, which is what stops a
 * surviving token elsewhere. Returns whether a scope reported success; the
 * caller still treats a SURVIVING SESSION, not this flag, as the real verdict.
 */
async function attemptSignOut(client: AuthCapableClient): Promise<boolean> {
  try {
    const { error } = await client.auth.signOut();
    if (!error) return true;
  } catch {
    // Fall through to the local scope.
  }
  try {
    const { error } = await client.auth.signOut({ scope: "local" });
    return !error;
  } catch {
    return false;
  }
}

/**
 * POSITIVE absence only — a `getSession()` that RESOLVED with no session.
 *
 * A rejection, a timeout or an offline network is NOT absence and must answer
 * `false`, because treating it as absence is what would release the guard while
 * a live session survived.
 */
async function sessionPositivelyAbsent(client: AuthCapableClient): Promise<boolean> {
  try {
    const { data } = await client.auth.getSession();
    return !data.session;
  } catch {
    return false;
  }
}

/**
 * checking                       — waiting for authoritative recovery
 * ready                          — confirmed recovery + live session
 * updating_password              — updateUser in flight
 * terminating_recovery_session   — sign-out in flight, password already changed
 * password_updated_but_session_active — FAIL CLOSED: retry sign-out only
 * completed                      — session proved gone
 * invalid                        — no authoritative recovery
 */
type Phase =
  | "checking"
  | "ready"
  | "updating_password"
  | "terminating_recovery_session"
  | "password_updated_but_session_active"
  | "completed"
  | "invalid";

export function StudioResetPassword() {
  // Constructing the DEDICATED recovery client is what parses the recovery
  // fragment, so it happens on this screen and nowhere else in the app. It is
  // called during render rather than in an effect because the parse must start
  // before the first paint, and it is idempotent — the module installs once,
  // however often React re-renders this component.
  installStudioRecoveryAuthority();

  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>(() =>
    // A recovery that reached password-update but was never proved terminated
    // stays fail-closed across rerender, route change and browser refresh.
    isStudioRecoveryTerminationIncomplete() ? "password_updated_but_session_active" : "checking",
  );
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settled = useRef(false);

  useEffect(() => {
    if (isStudioRecoveryTerminationIncomplete()) {
      settled.current = true;
      return;
    }
    let active = true;

    const settle = () => {
      if (!active || settled.current) return;
      // AUTHORITY: a PASSWORD_RECOVERY produced by THIS TAB's dedicated,
      // non-persistent recovery client. Never a URL hint, never the shared
      // deny marker, and never the ordinary client's event — that one may have
      // been broadcast here from a different tab.
      if (!isStudioLocalRecoveryAuthority()) return;
      const recoveryClient = getStudioRecoveryClient();
      if (!recoveryClient) return;
      // The live session must be the RECOVERY client's own. The ordinary shared
      // session is deliberately not consulted: it is exactly what a second tab
      // would also be able to see.
      void recoveryClient.auth.getSession().then(({ data }) => {
        if (!active || settled.current) return;
        if (data.session) {
          settled.current = true;
          setPhase("ready");
        }
      });
    };

    const declareInvalid = () => {
      if (!active || settled.current) return;
      settled.current = true;
      setPhase("invalid");
    };

    settle();
    const unsubscribe = subscribeStudioRecoveryMode(() => settle());

    // Supabase parses the link asynchronously, so a verdict on first paint
    // would be wrong. Wait for start-up, allow a short grace for event
    // ordering, then be negative.
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const onSettled = () => {
      if (!active || settled.current) return;
      clearTimeout(graceTimer);
      graceTimer = setTimeout(declareInvalid, STUDIO_RECOVERY_SETTLED_GRACE_MS);
    };
    const unsubscribeSettled = subscribeStudioAuthSettled(onSettled);
    if (isStudioAuthSettled()) onSettled();

    const backstop = setTimeout(declareInvalid, STUDIO_RECOVERY_SETTLE_MS);

    return () => {
      active = false;
      unsubscribe();
      unsubscribeSettled();
      clearTimeout(graceTimer);
      clearTimeout(backstop);
    };
  }, []);

  // Never leave a password value behind in component state.
  useEffect(
    () => () => {
      setPassword("");
      setConfirmation("");
    },
    [],
  );

  /**
   * Closes the recovery session and proves it. Never resubmits the password —
   * the password change has already happened by the time this runs, so a retry
   * retries sign-out and nothing else.
   */
  const terminateRecoverySession = useCallback(async (): Promise<void> => {
    setError(null);
    setPhase("terminating_recovery_session");

    const recoveryClient = getStudioRecoveryClient() as AuthCapableClient | null;

    // TWO sessions have to end, not one.
    //
    //   the DEDICATED recovery session — memory-only, this tab's own;
    //   any ORDINARY shared session — in localStorage, readable by every tab.
    //
    // The ordinary one matters even though recovery never created it: the
    // publisher may already have been signed in elsewhere when the reset began,
    // and releasing the origin-wide denial while that session survived would
    // hand a live dashboard straight back to the other tab.
    const recoverySignedOutCleanly = recoveryClient ? await attemptSignOut(recoveryClient) : true;
    // The ordinary client's own error is NOT the verdict here — it reports a
    // missing session as a failure, and "there was never a session" is a
    // perfectly good outcome. Only positive absence below decides.
    await attemptSignOut(supabase as unknown as AuthCapableClient);

    const recoveryAbsent = recoveryClient ? await sessionPositivelyAbsent(recoveryClient) : true;
    const ordinaryAbsent = await sessionPositivelyAbsent(supabase as unknown as AuthCapableClient);

    if (!recoverySignedOutCleanly || !recoveryAbsent || !ordinaryAbsent) {
      // FAIL CLOSED. Protection stays on, the dashboard stays blocked in every
      // tab, and the marker keeps it that way across a reload.
      markStudioRecoveryIncompleteTermination();
      setPhase("password_updated_but_session_active");
      return;
    }

    // Only now, with BOTH sessions positively confirmed absent, is it safe to
    // release — local authority first, then this tab's marker, then the
    // origin-wide one, which also notifies the other tabs. They settle to
    // `signed_out` and must sign in again normally; nothing here signs anyone
    // in. Dropping the dedicated client discards the last reference to the
    // memory-held recovery session.
    clearStudioRecoveryMode();
    clearStudioRecoveryIncompleteTermination();
    clearStudioRecoverySharedBlock();
    discardStudioRecoveryClient();
    setStudioPasswordUpdatedNotice();
    setPhase("completed");
    void navigate({ to: STUDIO_LOGIN_PATH });
  }, [navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const problem = validateStudioPassword(password, confirmation);
    if (problem) {
      // Blocks the network call entirely — updateUser is never reached.
      setError(studioPasswordProblemMessage(problem));
      return;
    }

    // Re-checked at the moment of use, not merely at the moment the form was
    // revealed. `updateUser` is reachable ONLY through the dedicated client
    // that proved local link consumption; the ordinary shared client is never
    // asked to change a password.
    const recoveryClient = getStudioRecoveryClient();
    if (!isStudioLocalRecoveryAuthority() || !recoveryClient) {
      setPhase("invalid");
      return;
    }

    setPhase("updating_password");
    // FOREVER-STUDIO-STALE-ASSET-RECOVERY-001. A password update is the most
    // consequential action in the application, and this route is additionally
    // on the automatic-recovery deny list, so a stale-asset reload can never
    // interrupt or replay it. Registered before the request leaves.
    const releasePasswordUpdate = beginConsequentialAction("password_update");
    try {
      const { error: updateError } = await recoveryClient.auth.updateUser({ password });
      if (updateError) {
        setPhase("ready");
        setError(studioRecoveryErrorMessage(updateError));
        return;
      }
    } catch (caught) {
      setPhase("ready");
      setError(studioRecoveryErrorMessage(caught));
      return;
    } finally {
      releasePasswordUpdate();
    }

    // Password changed. Discard the values immediately, and record that a
    // recovery is now mid-termination BEFORE attempting sign-out, so a crash,
    // refresh or navigation between here and confirmation still fails closed.
    setPassword("");
    setConfirmation("");
    markStudioRecoveryIncompleteTermination();
    await terminateRecoverySession();
  };

  if (phase === "checking") {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-4">
        <p className="text-center text-sm text-muted-foreground">Checking the reset link…</p>
      </div>
    );
  }

  if (phase === "invalid") {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-4">
        <h1 className="text-2xl font-semibold">Reset link expired</h1>
        <p role="alert" className="mt-2 text-sm text-muted-foreground">
          This reset link is no longer valid. Request a new one and use the most recent email.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Button asChild className="h-12 w-full text-base">
            <a href={STUDIO_FORGOT_PASSWORD_PATH}>Request a new link</a>
          </Button>
          <a href={STUDIO_LOGIN_PATH} className="text-sm font-medium underline underline-offset-4">
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

  if (phase === "terminating_recovery_session") {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-4">
        <h1 className="text-2xl font-semibold">Finishing securely</h1>
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          Password updated. Closing the recovery session…
        </p>
      </div>
    );
  }

  if (phase === "password_updated_but_session_active") {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-4">
        <h1 className="text-2xl font-semibold">Finish signing out</h1>
        <p role="alert" className="mt-2 text-sm text-muted-foreground">
          {STUDIO_SESSION_CLOSE_FAILED_NOTICE}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Stay on this page until it succeeds. Your new password is already saved — you will not be
          asked for it again here.
        </p>
        <Button
          type="button"
          className="mt-8 h-12 w-full text-base"
          onClick={() => void terminateRecoverySession()}
        >
          Retry secure sign-out
        </Button>
      </div>
    );
  }

  if (phase === "completed") {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-4">
        <h1 className="text-2xl font-semibold">Password updated</h1>
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          Sign in with the new password.
        </p>
        <a
          href={STUDIO_LOGIN_PATH}
          className="mt-8 text-sm font-medium underline underline-offset-4"
        >
          Go to Studio sign in
        </a>
      </div>
    );
  }

  const busy = phase === "updating_password";

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">Set a new password</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Use at least {STUDIO_PASSWORD_MIN_LENGTH} characters. You will sign in again afterwards.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="studio-new-password">New password</Label>
          <Input
            id="studio-new-password"
            name="new-password"
            type={reveal ? "text" : "password"}
            autoComplete="new-password"
            minLength={STUDIO_PASSWORD_MIN_LENGTH}
            required
            aria-describedby="studio-password-help"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="studio-confirm-password">Confirm new password</Label>
          <Input
            id="studio-confirm-password"
            name="confirm-password"
            type={reveal ? "text" : "password"}
            autoComplete="new-password"
            minLength={STUDIO_PASSWORD_MIN_LENGTH}
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>

        <p id="studio-password-help" className="text-xs text-muted-foreground">
          At least {STUDIO_PASSWORD_MIN_LENGTH} characters. Never share it in chat, a screenshot or
          a report.
        </p>

        {/* A real button, reachable by keyboard, whose state is announced. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={reveal}
          onClick={() => setReveal((value) => !value)}
        >
          {reveal ? "Hide passwords" : "Show passwords"}
        </Button>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="h-12 w-full text-base" disabled={busy}>
          {busy ? "Saving…" : "Save new password"}
        </Button>
      </form>
    </div>
  );
}
