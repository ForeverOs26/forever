/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the leaf-level success attestation
 * hook (independent-review P1-2).
 *
 * WHY EVERY AUTHENTICATED STUDIO LEAF CALLS THIS ITSELF. The recovered page has
 * to prove the thing that broke now works. For Studio, the thing that broke is
 * the authenticated chunk graph — the shell, the dashboard, the uploader, the
 * members view. So:
 *
 *   - a shell mount is NOT proof, and no longer clears anything;
 *   - a root mount is NOT proof, and never was a caller;
 *   - navigating to `/` is NOT proof, and is now actively refused;
 *   - the sign-in screen is NOT proof;
 *   - the recovery interstitial is NOT proof;
 *   - an error boundary mounting is NOT proof;
 *   - the DASHBOARD is proved by a successful authenticated overview;
 *   - the UPLOAD route is proved by the uploader leaf itself mounting;
 *   - the MEMBERS route is proved by its leaf AND its data boundary resolving.
 *
 * Each leaf therefore passes its own `ready`, and the hook adds the router
 * evidence and the exact live pathname. Nothing here stores a pathname, a
 * parameter or a query.
 */

import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

import { routeLoadEvidence, type RouterStateLike } from "./route-load-evidence";
import { attestStaleAssetRecovery } from "./stale-asset-recovery";

/**
 * Attests that THIS leaf reached a usable state.
 *
 * `ready` must mean "the visitor can use this page", not "React rendered
 * something". A loading placeholder, a denial screen and an unavailable screen
 * are all `false`.
 */
export function useStaleAssetRecoveryAttestation(ready: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    if (typeof window === "undefined") return;
    const evidence = routeLoadEvidence(router as unknown as RouterStateLike);
    attestStaleAssetRecovery({
      pathname: window.location.pathname,
      leafRouteLoaded: evidence.leafRouteLoaded,
      nestedModulesLoaded: evidence.nestedModulesLoaded,
      errorBoundaryActive: evidence.errorBoundaryActive,
      studioAuthenticatedReady: true,
    });
  }, [ready, router]);
}
