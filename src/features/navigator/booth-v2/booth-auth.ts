/**
 * Booth Mode 2.0 — server-enforced authorization middleware.
 *
 * Chains the existing Supabase JWT verification (requireSupabaseAuth) with the
 * Booth access boundary: the pilot must be explicitly enabled on this
 * deployment AND the caller must hold an active row in the existing
 * public.studio_members staff roster. Every Booth V2 server function runs
 * behind this middleware, so the browser UI is presentation only — hiding a
 * screen never grants anything, and an anonymous caller can reach nothing.
 *
 * This file ships to the client bundle as middleware plumbing; everything
 * sensitive stays inside the `.server()` callback (stripped from the browser
 * build) and inside dynamically imported server modules.
 */

import { createMiddleware } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const requireBoothStaff = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { resolveBoothActor, boothDenied } = await import("./server/access");
    const claims = context.claims as Record<string, unknown>;
    const email = typeof claims.email === "string" ? claims.email : null;
    let actor;
    try {
      actor = await resolveBoothActor({ userId: context.userId, email });
    } catch (error) {
      // Every failure collapses to the same opaque denial: a caller can never
      // distinguish "pilot disabled" from "not a staff member".
      throw error instanceof Error && error.name === "booth_access_denied" ? error : boothDenied();
    }
    return next({ context: { actor } });
  });
