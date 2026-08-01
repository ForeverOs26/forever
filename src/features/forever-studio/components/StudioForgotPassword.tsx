/**
 * Forever Studio password-request screen.
 *
 * Public by necessity — someone who cannot sign in must be able to reach it —
 * but it is NOT a sign-up path and it grants nothing. It asks Supabase to mail
 * a recovery link and then reports the same generic sentence no matter what
 * happened, so it cannot be used to discover whether an address has an
 * account, whether that account is confirmed, whether it is the Owner, or
 * whether it holds a Studio membership.
 *
 * The redirect target is a fixed application constant. It is never taken from
 * a query parameter, a form field, storage or remote content, so this form
 * cannot be turned into an open redirect that mails the recovery fragment to
 * a foreign origin.
 */

import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

import {
  isStudioRecoveryRateLimited,
  STUDIO_LOGIN_PATH,
  STUDIO_RECOVERY_GENERIC_NOTICE,
  studioRecoveryErrorMessage,
  studioResetPasswordRedirectUrl,
} from "../studio-recovery-contract";

type RequestState = "idle" | "sending" | "sent" | "rate_limited" | "unavailable";

export function StudioForgotPassword() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<RequestState>("idle");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState("sending");

    let redirectTo: string;
    try {
      // Origin only. Anything else on the current URL is discarded.
      redirectTo = studioResetPasswordRedirectUrl(window.location.origin);
    } catch {
      setState("unavailable");
      return;
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      // Rate limiting is the ONLY failure worth distinguishing, and it says
      // nothing about the address. Every other outcome — including "user not
      // found" — reports the identical generic result.
      setState(error && isStudioRecoveryRateLimited(error) ? "rate_limited" : "sent");
    } catch (caught) {
      setState(isStudioRecoveryRateLimited(caught) ? "rate_limited" : "unavailable");
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Enter the email address for your Forever Studio account. Access stays by Owner invitation
        only — this does not create an account.
      </p>

      {state === "sent" ? (
        <div className="mt-8 space-y-4">
          <p role="status" className="text-sm">
            {STUDIO_RECOVERY_GENERIC_NOTICE}
          </p>
          <Link
            to={STUDIO_LOGIN_PATH}
            className="inline-block text-sm font-medium underline underline-offset-4"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="studio-recovery-email">Email</Label>
            <Input
              id="studio-recovery-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          {state === "rate_limited" ? (
            <p role="alert" className="text-sm text-destructive">
              Too many attempts. Wait a few minutes and try again.
            </p>
          ) : null}
          {state === "unavailable" ? (
            <p role="alert" className="text-sm text-destructive">
              {studioRecoveryErrorMessage("network")}
            </p>
          ) : null}

          <Button
            type="submit"
            className="h-12 w-full text-base"
            disabled={state === "sending" || email.trim().length === 0}
          >
            {state === "sending" ? "Sending…" : "Send reset link"}
          </Button>

          <Link
            to={STUDIO_LOGIN_PATH}
            className="inline-block text-sm font-medium underline underline-offset-4"
          >
            Back to sign in
          </Link>
        </form>
      )}
    </div>
  );
}
