import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { installStaleAssetCapture } from "./lib/stale-asset/global-capture";

export const getRouter = () => {
  /**
   * Stale client asset capture (FOREVER-STUDIO-STALE-ASSET-RECOVERY-001).
   *
   * Installed HERE because this is the earliest point that is both guaranteed
   * to execute and guaranteed to survive bundling. The client entry always
   * calls `getRouter()` before the first route is resolved, so the listeners
   * exist before any route chunk can fail. A bare side-effect import would not
   * do: this package declares `"sideEffects": false` and the bundler drops such
   * imports — verified against the real production build.
   *
   * The call is idempotent and a no-op during server rendering.
   */
  installStaleAssetCapture();

  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
