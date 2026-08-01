import { Outlet, createFileRoute } from "@tanstack/react-router";

import { StudioLogin } from "@/features/forever-studio/components/StudioLogin";
import { StudioShell } from "@/features/forever-studio/components/StudioShell";
import { useStudioSession } from "@/features/forever-studio/components/useStudioSession";
import { STUDIO_RESET_PASSWORD_PATH } from "@/features/forever-studio/studio-recovery-contract";

/**
 * Forever Studio (FOREVER-STUDIO-001): the authenticated publisher tool.
 * Internal working surface — never indexed, never linked from public
 * navigation or the sitemap. The browser session only unlocks the shell;
 * every operation is re-authorized at the server boundary.
 */
export const Route = createFileRoute("/studio")({
  head: () => ({
    meta: [{ title: "Forever Studio" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: StudioRoute,
});

function StudioRoute() {
  const session = useStudioSession();
  if (session.status === "loading") {
    return <p className="py-24 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (session.status === "signed_out") return <StudioLogin />;
  // A recovery session is a real Supabase session but must never open the
  // dashboard: the dashboard calls Studio server functions, which run
  // `resolveStudioActor` → `maybeBootstrapOwner`, and an unfinished password
  // reset would then mint the Owner membership. Refuse the shell entirely and
  // send the visitor to finish the reset.
  if (session.status === "recovery") return <StudioRecoveryInterstitial />;
  return (
    <StudioShell email={session.email}>
      <Outlet />
    </StudioShell>
  );
}

function StudioRecoveryInterstitial() {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">Finish resetting your password</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        A password reset is in progress. Set the new password, then sign in again.
      </p>
      <a
        href={STUDIO_RESET_PASSWORD_PATH}
        className="mt-8 text-sm font-medium underline underline-offset-4"
      >
        Set a new password
      </a>
    </div>
  );
}
