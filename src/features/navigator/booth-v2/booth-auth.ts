/**
 * Booth Mode 2.0 — server-enforced authorization middleware.
 *
 * This middleware deliberately does NOT chain the shared Supabase-auth
 * middleware. That upstream middleware runs before any Booth code and throws
 * its own descriptive errors (missing header, unsupported scheme, invalid
 * token, missing Supabase configuration), which a downstream middleware cannot
 * intercept — so chaining it would leak distinct refusal reasons through Booth
 * endpoints and make the "single opaque denial" claim untrue.
 *
 * Instead the whole chain runs inside ONE `.server()` callback:
 *   1. verifyBoothRequestIdentity performs the identical Supabase JWT
 *      verification and normalizes every failure to `booth_access_denied`;
 *   2. resolveBoothActor requires the pilot to be explicitly enabled on this
 *      deployment, an ACTIVE row in the existing public.studio_members staff
 *      roster, and the explicit least-privilege `can_access_booth` capability
 *      — and fails into the same opaque denial.
 *
 * Every Booth V2 operational server function runs behind this middleware, so
 * the browser UI is presentation only: hiding a screen never grants anything,
 * and an anonymous caller can reach nothing.
 *
 * This file ships to the client bundle as middleware plumbing; everything
 * sensitive stays inside the `.server()` callback (stripped from the browser
 * build) and inside dynamically imported server modules.
 */

import { createMiddleware } from "@tanstack/react-start";

export const requireBoothStaff = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { resolveBoothActor, boothDenied } = await import("./server/access");
  const { verifyBoothRequestIdentity } = await import("./server/auth");
  try {
    const identity = await verifyBoothRequestIdentity();
    const actor = await resolveBoothActor(identity);
    return next({ context: { actor } });
  } catch (error) {
    // Every failure collapses to the same opaque denial: a caller can never
    // distinguish a missing header from a malformed or expired token, an
    // inactive membership, a missing Booth capability, or a disabled pilot.
    throw error instanceof Error && error.name === "booth_access_denied" ? error : boothDenied();
  }
});
