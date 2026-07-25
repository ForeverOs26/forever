/**
 * Booth Mode 2.0 — request identity verification (PR #102 corrective item 10).
 *
 * WHY THIS EXISTS AT ALL. Corrective pass 1 chained the shared
 * `requireSupabaseAuth` middleware in front of the Booth boundary and claimed
 * every authorization refusal collapsed to one opaque denial. Verified against
 * the REAL middleware order, that claim was false: the upstream middleware runs
 * FIRST and throws before any Booth code executes, so its distinct messages
 * ("No authorization header provided", "Only Bearer tokens are supported",
 * "Invalid token", and the Supabase-configuration error, which names the
 * missing environment variables) reached Booth callers verbatim. A downstream
 * middleware cannot catch an upstream middleware's throw.
 *
 * So Booth verifies the request identity ITSELF, here, performing exactly the
 * same checks as the generated shared middleware — which is machine-generated
 * and must not be edited — inside one try/catch that normalizes EVERY failure
 * to the single `booth_access_denied`. Missing header, malformed token,
 * expired token, inactive member, missing Booth capability and a disabled
 * pilot are now genuinely indistinguishable from outside; the operational
 * detail is written to the server log for operators and never to the wire.
 *
 * This module is server-only and is reached exclusively through a dynamic
 * import inside the middleware's `.server()` callback, so none of it is
 * reachable from the browser bundle.
 */

import { createClient } from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";

import { boothDenied } from "./access";

export interface BoothRequestIdentity {
  userId: string;
  email: string | null;
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

/**
 * Mirrors the shared middleware's fetch shim: new-style Supabase API keys are
 * opaque strings rather than bearer JWTs, so they must not occupy the
 * Authorization header the caller's token belongs in.
 */
function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

/**
 * Verify the caller's Supabase session and return only their identity.
 *
 * EVERY failure — configuration, missing header, wrong scheme, malformed
 * token, expired or otherwise invalid token, missing subject — throws the one
 * opaque Booth denial. The reason is logged server-side under a fixed prefix
 * and never crosses the boundary.
 */
export async function verifyBoothRequestIdentity(): Promise<BoothRequestIdentity> {
  let reason = "unknown";
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabasePublishableKey) {
      reason = "supabase_env_missing";
      throw boothDenied();
    }

    const request = getRequest();
    if (!request?.headers) {
      reason = "no_request_headers";
      throw boothDenied();
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      reason = "missing_authorization_header";
      throw boothDenied();
    }
    if (!authHeader.startsWith("Bearer ")) {
      reason = "unsupported_authorization_scheme";
      throw boothDenied();
    }

    const token = authHeader.slice("Bearer ".length);
    if (!token || token.split(".").length !== 3) {
      reason = "malformed_token";
      throw boothDenied();
    }

    const supabase = createClient(supabaseUrl, supabasePublishableKey, {
      global: {
        fetch: createSupabaseFetch(supabasePublishableKey),
        headers: { Authorization: `Bearer ${token}` },
      },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims) {
      // Covers expired, revoked, wrong-issuer and otherwise invalid tokens.
      reason = "token_rejected";
      throw boothDenied();
    }
    const claims = data.claims as Record<string, unknown>;
    if (typeof claims.sub !== "string" || claims.sub.length === 0) {
      reason = "no_subject_claim";
      throw boothDenied();
    }

    return {
      userId: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
    };
  } catch (error) {
    // Anything at all — including an unexpected throw from the Supabase client
    // — becomes the same denial. Operators get the reason; callers do not.
    if (reason === "unknown" && error instanceof Error) reason = `unexpected:${error.name}`;
    console.error(`[booth-v2] access denied (${reason})`);
    throw boothDenied();
  }
}
