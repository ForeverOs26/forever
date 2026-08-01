import { createFileRoute } from "@tanstack/react-router";

import { StudioResetPassword } from "@/features/forever-studio/components/StudioResetPassword";

/**
 * New-password screen (FOREVER-STUDIO-PASSWORD-RECOVERY-001).
 *
 * The exact landing target of a Supabase recovery link, and the only redirect
 * the request screen will ever ask for. The trailing underscore on `studio_`
 * keeps it OUT of the `/studio` layout route: a recovery session must not pass
 * through the Studio session gate, must not mount the dashboard, and must not
 * reach any Studio server function — otherwise `resolveStudioActor` would run
 * `maybeBootstrapOwner` and mint the Owner membership from an unfinished
 * password reset.
 *
 * Never indexed, never linked from public navigation, never in the sitemap.
 */
export const Route = createFileRoute("/studio_/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — Forever Studio" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: StudioResetPasswordRoute,
});

function StudioResetPasswordRoute() {
  return <StudioResetPassword />;
}
