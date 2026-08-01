/**
 * Forever Studio new-password screen — the landing target of a recovery link.
 *
 * It lives OUTSIDE the membership-protected Studio boundary on purpose: a
 * publisher who cannot sign in must be able to complete a reset, and requiring
 * a Studio membership here would deadlock the Owner before bootstrap has ever
 * run. It therefore loads no dashboard data and calls no Studio server
 * function.
 *
 * The bootstrap boundary is the point of this screen. A recovery session is a
 * real Supabase session, so anything that reached a Studio server function
 * with it would run `resolveStudioActor` → `maybeBootstrapOwner` and mint the
 * Owner membership from a half-finished password reset. Nothing here touches
 * that path, and the session is signed out before the visitor is returned to
 * the normal sign-in screen.
 *
 * The recovery token is never read, copied, stored or logged: recovery is
 * known only through the in-memory flag in `studio-recovery-mode`, and the
 * password is cleared from state the moment it has been submitted.
 */

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

import {
  STUDIO_FORGOT_PASSWORD_PATH,
  STUDIO_LOGIN_PATH,
  STUDIO_PASSWORD_MIN_LENGTH,
  STUDIO_RECOVERY_SETTLE_MS,
  STUDIO_RECOVERY_SETTLED_GRACE_MS,
  studioPasswordProblemMessage,
  studioRecoveryErrorMessage,
  validateStudioPassword,
} from "../studio-recovery-contract";
import {
  clearStudioRecoveryMode,
  installStudioRecoveryCapture,
  isStudioAuthSettled,
  isStudioRecoveryMode,
  setStudioPasswordUpdatedNotice,
  subscribeStudioAuthSettled,
  subscribeStudioRecoveryMode,
} from "./studio-recovery-mode";

// The event may already have fired before this module's component mounts.
installStudioRecoveryCapture();

type Phase = "checking" | "ready" | "saving" | "invalid" | "saved";

export function StudioResetPassword() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settled = useRef(false);

  useEffect(() => {
    let active = true;

    const settle = () => {
      if (!active || settled.current) return;
      if (!isStudioRecoveryMode()) return;
      void supabase.auth.getSession().then(({ data }) => {
        if (!active || settled.current) return;
        // Recovery mode AND a live session: only then may a password be set.
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

    // Supabase parses the link fragment asynchronously, so a verdict on first
    // paint would be wrong. Wait for the client to finish starting up, then
    // allow a short grace for event ordering, and only then be negative.
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const onSettled = () => {
      if (!active || settled.current) return;
      clearTimeout(graceTimer);
      graceTimer = setTimeout(declareInvalid, STUDIO_RECOVERY_SETTLED_GRACE_MS);
    };
    const unsubscribeSettled = subscribeStudioAuthSettled(onSettled);
    if (isStudioAuthSettled()) onSettled();

    // Backstop for a client that never reports start-up at all.
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
  useEffect(() => {
    return () => {
      setPassword("");
      setConfirmation("");
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const problem = validateStudioPassword(password, confirmation);
    if (problem) {
      // Blocks the network call entirely — updateUser is never reached.
      setError(studioPasswordProblemMessage(problem));
      return;
    }

    setPhase("saving");
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setPhase("ready");
        setError(studioRecoveryErrorMessage(updateError));
        return;
      }
    } catch (caught) {
      setPhase("ready");
      setError(studioRecoveryErrorMessage(caught));
      return;
    }

    // Discard the values first, then drop the recovery session. The recovery
    // session must never become a working dashboard session.
    setPassword("");
    setConfirmation("");
    clearStudioRecoveryMode();
    try {
      await supabase.auth.signOut();
    } catch {
      // Even if sign-out fails we still refuse to continue into Studio; the
      // visitor is returned to sign-in and must authenticate afresh.
    }
    setStudioPasswordUpdatedNotice();
    setPhase("saved");
    void navigate({ to: STUDIO_LOGIN_PATH });
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

  if (phase === "saved") {
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

  const busy = phase === "saving";

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
