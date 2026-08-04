/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — what "the route actually loaded"
 * means, read from the router rather than assumed.
 *
 * Closes the evidence half of independent-review P1-2. The reviewed design
 * treated a bare `router_resolved` event as proof, on any pathname, which is
 * how the recovery screen's own "Go to site" link cleared the guard. Proof has
 * to be specific:
 *
 *   - the LEAF match — the route the visitor actually asked for — settled
 *     successfully, not `pending`, not `error`, not `notFound`;
 *   - every match in the chain settled successfully, which is what "all
 *     required nested lazy modules for that route loaded" means for a nested
 *     route tree: a parent whose module is missing cannot report success;
 *   - no match in the chain carries an error, which is what "the route did not
 *     fall into an error boundary" means.
 *
 * This module reads a minimal structural shape rather than importing router
 * types, so it can be unit-tested directly with plain objects and cannot drag
 * the router into a test that has no DOM.
 */

export type RouteMatchLike = {
  status?: string;
  error?: unknown;
};

export type RouterStateLike = {
  state?: { matches?: readonly RouteMatchLike[] };
};

export type RouteLoadEvidence = {
  leafRouteLoaded: boolean;
  nestedModulesLoaded: boolean;
  errorBoundaryActive: boolean;
};

export const NOTHING_LOADED: RouteLoadEvidence = Object.freeze({
  leafRouteLoaded: false,
  nestedModulesLoaded: false,
  errorBoundaryActive: false,
});

/**
 * Derives load evidence from a router's current match chain.
 *
 * An empty chain proves nothing and is reported as nothing — never as success.
 */
export function routeLoadEvidence(router: RouterStateLike | null | undefined): RouteLoadEvidence {
  const matches = router?.state?.matches;
  if (!Array.isArray(matches) || matches.length === 0) return { ...NOTHING_LOADED };
  const leaf = matches[matches.length - 1];
  return {
    leafRouteLoaded: leaf?.status === "success",
    nestedModulesLoaded: matches.every((match) => match?.status === "success"),
    errorBoundaryActive: matches.some(
      (match) => match?.status === "error" || match?.error !== undefined,
    ),
  };
}
