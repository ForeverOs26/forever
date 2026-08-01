import { createFileRoute } from "@tanstack/react-router";

import { StudioForgotPassword } from "@/features/forever-studio/components/StudioForgotPassword";

/**
 * Password-request screen (FOREVER-STUDIO-PASSWORD-RECOVERY-001).
 *
 * The trailing underscore on the `studio_` segment keeps this OUT of the
 * `/studio` layout route, so it never passes through the Studio session gate
 * and never mounts the dashboard. Someone who cannot sign in has to be able to
 * reach it, so it is publicly routable — but it is not a sign-up path, it
 * grants nothing, and it is never indexed, never linked from public
 * navigation, and never listed in the sitemap.
 */
export const Route = createFileRoute("/studio_/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset password — Forever Studio" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: StudioForgotPasswordRoute,
});

function StudioForgotPasswordRoute() {
  return <StudioForgotPassword />;
}
