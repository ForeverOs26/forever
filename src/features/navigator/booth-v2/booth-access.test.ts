/**
 * Booth Mode 2.0 trust-boundary tests (PR #102 corrective items 1, 2, 3, 9
 * and 10).
 *
 * Proves at the SERVICE layer that:
 *   • the pilot is disabled by default and never read from a client-visible
 *     VITE_* flag;
 *   • active Studio membership is NOT sufficient — the explicit
 *     `can_access_booth` capability is additionally required, and no user has
 *     it by default;
 *   • every refusal collapses to one opaque code that reveals nothing;
 *   • a refused call performs ZERO database work: the fake service-role client
 *     records every operation attempted, and the assertions require that
 *     record to stay empty;
 *   • every operational endpoint is independently gated.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbOperations: string[] = [];

/** The studio_members row the mocked service-role read returns next. */
interface MemberRow {
  user_id: string;
  role: string;
  display_name: string | null;
  email: string | null;
  is_active: boolean;
  can_access_booth: boolean;
}
const membership: { row: MemberRow | null; error: { message?: string } | null } = {
  row: null,
  error: null,
};

/**
 * A service-role client stand-in that records any attempt to touch the
 * database. Reaching booth data at all during a denied call is a test failure.
 */
vi.mock("@/integrations/supabase/client.server", () => {
  const record = (operation: string) => {
    dbOperations.push(operation);
  };
  const builder = (table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () =>
          table === "studio_members"
            ? { data: membership.row, error: membership.error }
            : { data: null, error: null },
      }),
      in: async () => ({ data: [], error: null }),
      order: async () => ({ data: [], error: null }),
    }),
    insert: async () => ({ data: null, error: null }),
    update: () => ({ eq: async () => ({ data: null, error: null }) }),
    upsert: async () => ({ data: null, error: null }),
  });
  return {
    supabaseAdmin: {
      from: (table: string) => {
        record(`from:${table}`);
        return builder(table);
      },
      rpc: async (fn: string) => {
        record(`rpc:${fn}`);
        return { data: null, error: null };
      },
    },
  };
});

import { resolveBoothActor, isBoothV2Enabled, BoothAccessError } from "./server/access";

const ORIGINAL_ENV = { ...process.env };
const ACTIVE_MEMBER: MemberRow = {
  user_id: "33333333-3333-3333-3333-333333333333",
  role: "owner",
  display_name: "Staff Member",
  email: "staff@example.test",
  is_active: true,
  can_access_booth: false,
};

beforeEach(() => {
  dbOperations.length = 0;
  membership.row = null;
  membership.error = null;
  delete process.env.BOOTH_V2_ENABLED;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("Booth V2 enablement is default-disabled", () => {
  it("is disabled when the flag is absent, empty, or not exactly 'true'", () => {
    expect(isBoothV2Enabled()).toBe(false);
    process.env.BOOTH_V2_ENABLED = "";
    expect(isBoothV2Enabled()).toBe(false);
    process.env.BOOTH_V2_ENABLED = "1";
    expect(isBoothV2Enabled()).toBe(false);
    process.env.BOOTH_V2_ENABLED = "TRUE";
    expect(isBoothV2Enabled()).toBe(false);
    process.env.BOOTH_V2_ENABLED = "yes";
    expect(isBoothV2Enabled()).toBe(false);
    process.env.BOOTH_V2_ENABLED = "true";
    expect(isBoothV2Enabled()).toBe(true);
  });

  it("refuses a fully authorized staff session while the pilot is disabled — zero DB work", async () => {
    membership.row = { ...ACTIVE_MEMBER, can_access_booth: true };
    await expect(
      resolveBoothActor({ userId: ACTIVE_MEMBER.user_id, email: "a@b.co" }),
    ).rejects.toBeInstanceOf(BoothAccessError);
    expect(dbOperations).toEqual([]);
  });

  it("never reads the flag from a client-visible VITE_* variable", async () => {
    process.env.VITE_BOOTH_V2_ENABLED = "true";
    expect(isBoothV2Enabled()).toBe(false);
    await expect(resolveBoothActor({ userId: "u", email: null })).rejects.toThrow();
    expect(dbOperations).toEqual([]);
  });
});

describe("Booth V2 requires an ACTIVE membership AND the explicit Booth capability", () => {
  beforeEach(() => {
    process.env.BOOTH_V2_ENABLED = "true";
  });

  it("refuses a caller with no user id before touching the database", async () => {
    await expect(resolveBoothActor({ userId: "", email: null })).rejects.toBeInstanceOf(
      BoothAccessError,
    );
    expect(dbOperations).toEqual([]);
  });

  it("refuses an authenticated account that is not a staff member at all", async () => {
    membership.row = null;
    await expect(
      resolveBoothActor({ userId: "22222222-2222-2222-2222-222222222222", email: "x@y.co" }),
    ).rejects.toBeInstanceOf(BoothAccessError);
    // It may read studio_members, but it must never proceed to booth data.
    expect(dbOperations.filter((op) => op.includes("booth_"))).toEqual([]);
  });

  it("refuses an ACTIVE Studio member who lacks the Booth capability", async () => {
    membership.row = { ...ACTIVE_MEMBER, is_active: true, can_access_booth: false };
    await expect(
      resolveBoothActor({ userId: ACTIVE_MEMBER.user_id, email: "staff@example.test" }),
    ).rejects.toBeInstanceOf(BoothAccessError);
    expect(dbOperations.filter((op) => op.includes("booth_"))).toEqual([]);
  });

  it("refuses an INACTIVE member even when they hold the Booth capability", async () => {
    membership.row = { ...ACTIVE_MEMBER, is_active: false, can_access_booth: true };
    await expect(
      resolveBoothActor({ userId: ACTIVE_MEMBER.user_id, email: "staff@example.test" }),
    ).rejects.toBeInstanceOf(BoothAccessError);
    expect(dbOperations.filter((op) => op.includes("booth_"))).toEqual([]);
  });

  it("allows ONLY an active member who also holds the Booth capability", async () => {
    membership.row = { ...ACTIVE_MEMBER, is_active: true, can_access_booth: true };
    const actor = await resolveBoothActor({
      userId: ACTIVE_MEMBER.user_id,
      email: "staff@example.test",
    });
    expect(actor).toEqual({
      userId: ACTIVE_MEMBER.user_id,
      email: "staff@example.test",
      displayName: "Staff Member",
      role: "owner",
    });
  });

  it("reads the capability column from the EXISTING roster, not a second table", async () => {
    membership.row = { ...ACTIVE_MEMBER, can_access_booth: true };
    await resolveBoothActor({ userId: ACTIVE_MEMBER.user_id, email: null });
    expect(dbOperations).toEqual(["from:studio_members"]);
  });

  it("treats a membership lookup failure as a denial, never an open door", async () => {
    membership.row = { ...ACTIVE_MEMBER, can_access_booth: true };
    membership.error = { message: "connection reset" };
    await expect(
      resolveBoothActor({ userId: ACTIVE_MEMBER.user_id, email: null }),
    ).rejects.toBeInstanceOf(BoothAccessError);
  });

  it("uses one opaque denial code for every distinct reason", async () => {
    const reasons: Array<() => void> = [
      () => {
        membership.row = null;
      },
      () => {
        membership.row = { ...ACTIVE_MEMBER, is_active: false, can_access_booth: true };
      },
      () => {
        membership.row = { ...ACTIVE_MEMBER, is_active: true, can_access_booth: false };
      },
      () => {
        delete process.env.BOOTH_V2_ENABLED;
        membership.row = { ...ACTIVE_MEMBER, can_access_booth: true };
      },
    ];
    for (const arrange of reasons) {
      process.env.BOOTH_V2_ENABLED = "true";
      arrange();
      const denial = await resolveBoothActor({
        userId: ACTIVE_MEMBER.user_id,
        email: null,
      }).catch((error) => error);
      expect(denial).toBeInstanceOf(BoothAccessError);
      expect((denial as BoothAccessError).code).toBe("booth_access_denied");
      expect((denial as BoothAccessError).message).toBe("Booth Mode 2.0 is not available.");
      expect((denial as BoothAccessError).message).not.toMatch(
        /member|flag|enabled|studio|capabilit|inactive|token|header/i,
      );
    }
  });
});

describe("every Booth V2 endpoint is gated", () => {
  const source = () =>
    import("node:fs").then((fs) =>
      fs.readFileSync("src/features/navigator/booth-v2/booth-v2.functions.ts", "utf8"),
    );

  /**
   * The single documented exception (item 9): an unauthenticated boolean that
   * says whether the deployment enabled the pilot at all, so a disabled
   * deployment can render the ordinary not-found boundary to a SIGNED-OUT
   * visitor instead of a Forever Booth login form.
   */
  const UNGATED_BY_DESIGN = ["boothV2GetRouteAvailability"];

  it("declares requireBoothStaff on every exported server function but the availability probe", async () => {
    const text = await source();
    const exported = [...text.matchAll(/export const (boothV2\w+) = createServerFn/g)].map(
      (match) => match[1],
    );
    expect(exported.length).toBeGreaterThanOrEqual(13);
    // Only the SERVER FUNCTIONS are gated; the module also exports the
    // client-observed event schema, which is a validation contract, not an
    // endpoint (see booth-funnel-integrity.test.ts).
    const blocks = text
      .split("export const ")
      .slice(1)
      .filter((block) => block.includes("createServerFn"));
    expect(blocks).toHaveLength(exported.length);
    for (const block of blocks) {
      const name = block.slice(0, block.indexOf(" "));
      const expected = !UNGATED_BY_DESIGN.includes(name);
      expect(`${name}:${block.includes(".middleware([requireBoothStaff])")}`).toBe(
        `${name}:${expected}`,
      );
    }
  });

  it("keeps the ungated probe to a single boolean — no session, no data, no actor", async () => {
    const text = await source();
    const probe = text.slice(text.indexOf("export const boothV2GetRouteAvailability"));
    const body = probe.slice(0, probe.indexOf("\n});") + 4);
    expect(body).toContain("isBoothV2Enabled()");
    expect(body).not.toMatch(/clientRef|actor|supabaseAdmin|service|rpc\(/);
    // It cannot leak an actor because it never resolves one.
    expect(body).not.toContain("context");
  });

  it("never accepts a client-supplied host identity", async () => {
    const text = await source();
    expect(text).not.toMatch(/hostLabel/);
    expect(text).not.toMatch(/hostUserId/);
  });

  it("no longer chains the shared auth middleware, whose errors could not be normalized", async () => {
    const authSource = await import("node:fs").then((fs) =>
      fs.readFileSync("src/features/navigator/booth-v2/booth-auth.ts", "utf8"),
    );
    // Chaining it would let its distinct messages ("No authorization header
    // provided", "Only Bearer tokens are supported", "Invalid token", the
    // Supabase-configuration error) escape ahead of any Booth code.
    expect(authSource).not.toMatch(/\.middleware\(\[requireSupabaseAuth\]\)/);
    expect(authSource).not.toMatch(/from "@\/integrations\/supabase\/auth-middleware"/);
    expect(authSource).toContain("verifyBoothRequestIdentity");
    expect(authSource).toContain("boothDenied()");
  });
});
