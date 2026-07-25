import { createFileRoute } from "@tanstack/react-router";

import { BoothV2Gate } from "@/features/navigator/booth-v2";
import {
  boothV2RouteBeforeLoad,
  boothV2RouteHead,
  boothV2RouteLoader,
} from "@/features/navigator/booth-v2/booth-route-boundary";

/**
 * Booth Mode 2.0 — the Forever Assisted Decision Concierge (pilot).
 *
 * Parallel pilot route: `/booth` keeps the legacy booth untouched while this
 * shell is reviewed. Staff-only, deliberately NOT in public navigation or the
 * sitemap; `noindex` keeps it out of search. Replacing `/booth` with this
 * flow is a separate, explicit Owner action documented in
 * docs/FOREVER_BOOTH_ASSISTED_DECISION_001.md.
 *
 * ENABLEMENT IS DECIDED AT THE ROUTE LOAD BOUNDARY (PR #102 corrective pass 3,
 * item 2). `beforeLoad` asks the server-only availability boundary FIRST and
 * throws TanStack `notFound()` while the pilot is disabled, so a disabled
 * deployment returns the application's ordinary not-found response with no
 * Booth title, description, font links, Loading state, staff sign-in form or
 * client shell, and makes no operational Booth call. The `head` is gated on this
 * route's own loader data as well. See booth-route-boundary.ts for the
 * reasoning; booth-route-ssr.test.tsx proves it against real SSR output.
 *
 * Once enabled, the route continues to the authentication Gate: signed-out
 * visitors see staff sign-in, a signed-in account without the Booth capability
 * sees the same not-found boundary, and only an authorized staff account reaches
 * Booth V2. Enablement gating here is a routing decision, never the security
 * boundary — every operational endpoint remains independently protected.
 */
export const Route = createFileRoute("/booth-v2")({
  beforeLoad: boothV2RouteBeforeLoad,
  loader: boothV2RouteLoader,
  head: boothV2RouteHead,
  component: BoothV2Route,
});

function BoothV2Route() {
  return <BoothV2Gate />;
}
