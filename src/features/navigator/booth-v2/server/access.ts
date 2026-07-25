/**
 * Booth Mode 2.0 — server-enforced access boundary (PR #102 corrective item 1
 * and 2).
 *
 * TWO independent conditions must BOTH hold before any Booth V2 operation
 * runs, and both are evaluated on the server only:
 *
 *   1. the pilot is explicitly enabled for this deployment
 *      (BOOTH_V2_ENABLED === "true" — DEFAULT DISABLED, and never read from a
 *      client-visible VITE_* flag);
 *   2. the caller presents a valid Supabase session whose account holds an
 *      ACTIVE row in public.studio_members — the existing Forever staff
 *      roster. No second staff identity system is introduced, and there is no
 *      self-registration or bootstrap path here: an account that is not
 *      already an active member is refused.
 *
 * Host identity is derived from that membership, never from client input.
 * Anything missing fails closed with a stable, non-descriptive denial.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Server-boundary refusal. `name` carries the stable code across the wire. */
export class BoothAccessError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = code;
    this.code = code;
  }
}

/** The single denial surface: callers never learn WHY they were refused. */
export function boothDenied(): BoothAccessError {
  return new BoothAccessError("booth_access_denied", "Booth Mode 2.0 is not available.");
}

/** Default-disabled: absence, "false", or any other value means disabled. */
export function isBoothV2Enabled(): boolean {
  return process.env.BOOTH_V2_ENABLED === "true";
}

interface StudioMemberRow {
  user_id: string;
  role: string;
  display_name: string | null;
  email: string | null;
  is_active: boolean;
}

export interface BoothActor {
  userId: string;
  email: string | null;
  displayName: string | null;
  /** The staff role from studio_members (kept for audit/labelling only). */
  role: string;
}

/**
 * Resolve the authenticated caller into an authorized Booth actor. Throws the
 * single opaque denial when the pilot is disabled or the account is not an
 * active staff member.
 */
export async function resolveBoothActor(session: {
  userId: string;
  email: string | null;
}): Promise<BoothActor> {
  if (!isBoothV2Enabled()) throw boothDenied();
  if (!session.userId) throw boothDenied();

  // The generated Database types predate the Studio tables (their migration is
  // applied but the types were never regenerated), so this read goes through an
  // untyped client and narrows the row itself — the same pattern the Studio
  // data layer uses.
  const members = supabaseAdmin as unknown as {
    from(table: string): {
      select(columns: string): {
        eq(
          column: string,
          value: string,
        ): {
          maybeSingle(): Promise<{
            data: StudioMemberRow | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };

  const { data, error } = await members
    .from("studio_members")
    .select("user_id, role, display_name, email, is_active")
    .eq("user_id", session.userId)
    .maybeSingle();

  if (error) {
    // A membership lookup failure is a denial, never an open door.
    console.error("[booth-v2] membership lookup failed");
    throw boothDenied();
  }
  if (!data || !data.is_active) throw boothDenied();

  return {
    userId: data.user_id,
    email: data.email ?? session.email,
    displayName: data.display_name,
    role: data.role,
  };
}
