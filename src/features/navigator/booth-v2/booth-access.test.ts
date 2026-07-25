/**
 * Booth Mode 2.0 trust-boundary tests (PR #102 corrective items 1 and 2).
 *
 * Proves at the SERVICE layer that an unauthenticated or unauthorized caller
 * reaches nothing, that the pilot is disabled by default, and — critically —
 * that a refused call performs ZERO database work: the fake service-role
 * client records every operation attempted, and the assertions require that
 * record to stay empty.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbOperations: string[] = [];

/**
 * A service-role client stand-in that records any attempt to touch the
 * database. Reaching it at all during a denied call is a test failure.
 */
vi.mock("@/integrations/supabase/client.server", () => {
  const record = (operation: string) => {
    dbOperations.push(operation);
  };
  const builder = () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
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
        return builder();
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

beforeEach(() => {
  dbOperations.length = 0;
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

  it("refuses a valid staff session while the pilot is disabled — with zero DB work", async () => {
    await expect(
      resolveBoothActor({ userId: "11111111-1111-1111-1111-111111111111", email: "a@b.co" }),
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

describe("Booth V2 requires an active staff membership", () => {
  beforeEach(() => {
    process.env.BOOTH_V2_ENABLED = "true";
  });

  it("refuses a caller with no user id before touching the database", async () => {
    await expect(resolveBoothActor({ userId: "", email: null })).rejects.toBeInstanceOf(
      BoothAccessError,
    );
    expect(dbOperations).toEqual([]);
  });

  it("refuses an authenticated account that is not a staff member", async () => {
    // The mocked membership read returns null (no row).
    await expect(
      resolveBoothActor({ userId: "22222222-2222-2222-2222-222222222222", email: "x@y.co" }),
    ).rejects.toBeInstanceOf(BoothAccessError);
    // It may read studio_members, but it must never proceed to booth data.
    expect(dbOperations.filter((op) => op.includes("booth_"))).toEqual([]);
  });

  it("uses one opaque denial code that reveals nothing about the reason", async () => {
    const denial = await resolveBoothActor({ userId: "u", email: null }).catch((error) => error);
    expect(denial).toBeInstanceOf(BoothAccessError);
    expect((denial as BoothAccessError).code).toBe("booth_access_denied");
    expect((denial as BoothAccessError).message).not.toMatch(/member|flag|enabled|studio/i);
  });
});

describe("every Booth V2 endpoint is gated", () => {
  it("declares requireBoothStaff on every exported server function", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/features/navigator/booth-v2/booth-v2.functions.ts", "utf8"),
    );
    const exported = [...source.matchAll(/export const (boothV2\w+) = createServerFn/g)].map(
      (match) => match[1],
    );
    expect(exported.length).toBeGreaterThanOrEqual(13);
    // Each createServerFn block must chain the middleware before its handler.
    const blocks = source.split("export const ").slice(1);
    for (const block of blocks) {
      const name = block.slice(0, block.indexOf(" "));
      expect(`${name}:${block.includes(".middleware([requireBoothStaff])")}`).toBe(`${name}:true`);
    }
  });

  it("never accepts a client-supplied host identity", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/features/navigator/booth-v2/booth-v2.functions.ts", "utf8"),
    );
    expect(source).not.toMatch(/hostLabel/);
    expect(source).not.toMatch(/hostUserId/);
  });
});
