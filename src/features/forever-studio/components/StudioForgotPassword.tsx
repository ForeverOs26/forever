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

type RequestState = "idle" | "sending" | "sent" | "unavailable";

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
      await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      // EVERY returned outcome reports the identical generic result: success,
      // "user not found", an unconfirmed or disabled account, a non-member —
      // and rate limiting.
      //
      // Rate limiting used to be shown separately, on the reasoning that a
      // limit says nothing about an address. That does not hold for this
      // provider and could not be disproved without querying a live backend.
      // Supabase answers a recovery request for an UNKNOWN address with a
      // success status and sends no mail — that is its own anti-enumeration
      // measure — while a KNOWN address actually sends one and draws down the
      // project's email quota. Repeating a request therefore tends to produce
      // "too many attempts" for an address that exists and the generic notice
      // for one that does not, which is an account-existence oracle assembled
      // out of two individually harmless messages.
      //
      // The cost of folding it in is that a genuinely rate-limited publisher is
      // told to check the inbox instead of to wait. The generic notice already
      // says to check spam, and a second attempt costs nothing.
      setState("sent");
    } catch (caught) {
      // A THROWN failure is a transport fault — offline, DNS, TLS, timeout —
      // and is identity-independent, so reporting it is safe. A thrown rate
      // limit is still folded into the generic result, so that the choice
      // between "unavailable" and the notice cannot become the same oracle.
      setState(isStudioRecoveryRateLimited(caught) ? "sent" : "unavailable");
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

          {/*
            There is deliberately no rate-limited branch. A distinct
            "too many attempts" message is only reachable for an address the
            provider actually mails, so rendering it would tell a prober which
            addresses exist. Rate limiting resolves to the generic notice above.
          */}
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
