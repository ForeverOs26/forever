/**
 * Forever Studio sign-in.
 *
 * Deliberately sign-in only: there is NO sign-up path anywhere in Studio.
 * Accounts exist only through an Owner invitation, and even a validly
 * signed-in account without an active membership is rejected by the server
 * boundary.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export function StudioLogin() {
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
      <h1 className="text-2xl font-semibold">Forever Studio</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Publisher sign-in. Access is by Owner invitation only.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="studio-email">Email</Label>
          <Input
            id="studio-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="studio-password">Password</Label>
          <Input
            id="studio-password"
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
