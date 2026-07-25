/**
 * Settled, non-enumerating failure state for guarded Studio routes.
 *
 * Detail endpoints intentionally use one indistinguishable denial for a
 * missing, cross-publisher, or legacy Owner-managed object. Do not accept or
 * render the thrown error here: server-function errors can be transport
 * errors, and rendering their text would risk disclosing infrastructure
 * detail. The back link is a normal history entry, so direct links and Back
 * remain usable without a redirect or retry loop.
 *
 * A route query failure is rendered as a DENIAL only when the server proved
 * one (a StudioAccessError safe code crossing the boundary via error.name).
 * Everything else — "Failed to fetch" while offline, an aborted request, a
 * sanitized studio_request_failed envelope — is a transient lookup failure
 * and renders as StudioRouteUnavailable instead: a definitive authorization
 * denial must never be synthesized from a network hiccup.
 */
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

/**
 * Safe denial codes the server actually issues for guarded route lookups.
 * Deliberately enumerated (default = transient): an unknown error name must
 * degrade to the retryable panel, never to a fabricated permanent denial.
 */
const ROUTE_DENIAL_CODES = new Set([
  "studio_access_denied",
  "studio_membership_required",
  "studio_membership_disabled",
  "studio_owner_required",
  "studio_disabled_in_partner_demo",
  "project_not_found",
  "listing_not_found",
]);

/** True only for a server-proven authorization/existence denial. */
export function isStudioRouteDenial(error: unknown): boolean {
  return error instanceof Error && ROUTE_DENIAL_CODES.has(error.name);
}

export function StudioRouteDenied() {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Studio access denied</h1>
      <p className="text-sm text-muted-foreground">
        This page is unavailable for this Studio account.
      </p>
      <Link to="/studio" className="text-sm font-medium underline underline-offset-4">
        Back to Studio
      </Link>
    </div>
  );
}

/**
 * Transient lookup failure: nothing was denied and nothing was lost. Shown
 * instead of the denial page whenever the route query failed without a
 * server-proven denial code; recovers via the retry button or the query
 * cache's own reconnect refetch.
 */
export function StudioRouteUnavailable(props: { onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Studio is unreachable right now</h1>
      <p className="text-sm text-muted-foreground">
        The connection dropped before Forever could load this page. Your account and uploads are
        unaffected — retry once you are back online.
      </p>
      <div className="flex justify-center">
        <Button onClick={props.onRetry}>Retry</Button>
      </div>
    </div>
  );
}
