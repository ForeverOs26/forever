/**
 * Forever Studio — server-enforced authorization middleware.
 *
 * Chains the existing Supabase JWT verification (requireSupabaseAuth) with
 * an active studio_members lookup. Every Studio server function runs behind
 * this middleware, so the browser UI is presentation only: hiding a button
 * never grants or denies anything.
 *
 * This file ships to the client bundle as middleware plumbing; everything
 * sensitive stays inside the `.server()` callback, which the compiler strips
 * from the browser build, and inside dynamically imported *.server modules.
 */

import { createMiddleware } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const requireStudioMember = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { createStudioDeps } = await import("./server/deps.server");
    const { resolveStudioActor } = await import("./server/membership");
    const deps = createStudioDeps();
    const claims = context.claims as Record<string, unknown>;
    const email = typeof claims.email === "string" ? claims.email : null;
    const actor = await resolveStudioActor(deps, { userId: context.userId, email });
    return next({ context: { deps, actor } });
  });
