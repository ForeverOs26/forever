/**
 * Booth Mode 2.0 — server-enforced authorization middleware, with the browser
 * credential transport that makes it reachable at all.
 *
 * TWO STAGES, AND BOTH ARE NECESSARY.
 *
 * `.client()` — CREDENTIAL TRANSPORT (PR #102 corrective pass 3, item 1).
 * Corrective pass 2 shipped only the `.server()` stage. The Booth UI holds its
 * Supabase session in the browser, but a bare server-function call carries no
 * Authorization header, so the server saw an anonymous request and refused a
 * genuinely signed-in Host before the membership and capability checks could
 * even run. Booth now attaches the caller's own access token itself, through
 * the official TanStack function-middleware transport (`next({ headers })`),
 * rather than depending on a repo-wide generated middleware it does not own.
 *
 * The token travels ONLY as `Authorization: Bearer <access_token>` on the
 * outgoing request. It is never placed in the function's data payload, in a
 * query string, in a log line, in custom storage, in React state, or in an
 * error message — the stage returns nothing but headers, and the one failure
 * path attaches no header at all instead of describing what went wrong.
 * `supabase.auth.getSession()` is deliberate: it returns the stored session and
 * refreshes it first when it has expired, so a Host whose tablet has been idle
 * gets a fresh token instead of a denial.
 *
 * `.server()` — AUTHORIZATION. Attaching a token proves nothing. The server
 * re-verifies the JWT from the inbound request on every single call and derives
 * the actor from the database, never from anything the client asserted. This
 * middleware deliberately does NOT chain the shared Supabase-auth middleware:
 * that upstream middleware runs before any Booth code and throws its own
 * descriptive errors (missing header, unsupported scheme, invalid token,
 * missing Supabase configuration), which a downstream middleware cannot
 * intercept — so chaining it would leak distinct refusal reasons through Booth
 * endpoints and make the "single opaque denial" claim untrue.
 *
 * Instead the whole authorization chain runs inside ONE `.server()` callback:
 *   1. verifyBoothRequestIdentity performs the identical Supabase JWT
 *      verification and normalizes every failure to `booth_access_denied`;
 *   2. resolveBoothActor requires the pilot to be explicitly enabled on this
 *      deployment, an ACTIVE row in the existing public.studio_members staff
 *      roster, and the explicit least-privilege `can_access_booth` capability
 *      — and fails into the same opaque denial.
 *
 * A missing, expired, malformed or foreign-signed token, an inactive
 * membership, a missing capability and a disabled pilot therefore remain
 * indistinguishable from outside.
 *
 * Every Booth V2 operational server function runs behind this middleware, so
 * the browser UI is presentation only: hiding a screen never grants anything,
 * and an anonymous caller can reach nothing. The intentionally public
 * `boothV2GetRouteAvailability` probe does NOT use this middleware and is
 * therefore never given a Booth-attached credential.
 *
 * This file ships to the client bundle as middleware plumbing; the `.client()`
 * stage is browser transport only, and everything sensitive stays inside the
 * `.server()` callback (stripped from the browser build) and inside
 * dynamically imported server modules.
 */

import { createMiddleware } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";

export const requireBoothStaff = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    let authorization: string | undefined;
    try {
      // Returns the stored session, refreshing it first when it has expired.
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (typeof accessToken === "string" && accessToken.length > 0) {
        authorization = `Bearer ${accessToken}`;
      }
    } catch {
      // Signed out, unreadable storage, a refresh that failed, or an
      // unconfigured Supabase client: attach nothing and say nothing. The
      // server produces the one opaque denial, so no transport failure can
      // become a distinguishable error — or leak a token into a message.
    }
    return next(authorization ? { headers: { Authorization: authorization } } : {});
  })
  .server(async ({ next }) => {
    const { resolveBoothActor, boothDenied } = await import("./server/access");
    const { verifyBoothRequestIdentity } = await import("./server/auth");
    try {
      // The JWT is verified here from the INBOUND request. That the client
      // attached a token is not evidence that the token is valid.
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
