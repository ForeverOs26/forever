/**
 * Booth Mode 2.0 — funnel integrity and non-enumerable session refusals
 * (PR #102 corrective pass 3, items 3 and 4).
 *
 * ITEM 3 — WHAT WAS WRONG. `boothV2RecordEvent` accepted any member of the
 * complete funnel vocabulary. An authenticated Host — or a future UI mistake —
 * could therefore assert transitions that never happened: whatsapp_verified,
 * guide_assigned, guide_acknowledged, guide_contacted, consultation_booked,
 * profile_confirmed, qr_continuation. The pilot scorecard reads those rows as
 * facts, so a forgeable transition event is a forgeable metric.
 *
 * The vocabulary is now split, and the split is enforced FOUR times over. This
 * suite pins three of the four layers (the TypeScript type, the endpoint's zod
 * validator and the service allowlist); the fourth — `booth_record_event`
 * itself — is proven against a real database in tests/booth.postgres.sql, and
 * the migration text is pinned in booth-v2-migration-contract.test.ts.
 *
 * ITEM 4 — WHAT WAS WRONG. An unknown client_ref answered "This booth session
 * no longer exists." while a client_ref owned by someone else answered "This
 * booth session belongs to another Host." The difference let a valid staff
 * caller enumerate other Hosts' sessions. Both now collapse to one code and one
 * message, with the operational distinction kept in the server log only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}
const rpcCalls: RpcCall[] = [];
const tableReads: string[] = [];
/** The booth_sessions row the mocked service-role read returns next. */
const sessionRow: { data: Record<string, unknown> | null } = { data: null };

vi.mock("@/integrations/supabase/client.server", () => {
  const from = (table: string) => {
    tableReads.push(table);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === "booth_sessions"
              ? { data: sessionRow.data, error: null }
              : { data: null, error: null },
          in: async () => ({ data: [], error: null }),
        }),
        in: async () => ({ data: [], error: null }),
        order: async () => ({ data: [], error: null }),
      }),
    };
  };
  return {
    supabaseAdmin: {
      from,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return { data: null, error: null };
      },
    },
  };
});

import { readFileSync } from "node:fs";

import {
  BOOTH_CLIENT_OBSERVED_EVENTS,
  BOOTH_FUNNEL_EVENTS,
  BOOTH_SERVER_ONLY_EVENTS,
  isBoothClientObservedEvent,
} from "../core/v2";
import { recordFunnelEvent, startWhatsappVerification } from "./server/service";
import type { BoothActor } from "./server/access";

const ACTOR: BoothActor = {
  userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  email: "host@example.test",
  displayName: "Host A",
  role: "owner",
};
const CLIENT_REF = "ref-funnel-integrity-01";

/** The transitions the architect enumerated, each with its owning RPC. */
const TRANSITION_EVENT_OWNERS: Record<string, string> = {
  profile_confirmed: "booth_mark_profile_confirmed",
  whatsapp_verified: "booth_set_whatsapp_state",
  guide_assigned: "booth_assign_guide",
  guide_acknowledged: "booth_acknowledge_guide",
  guide_contacted: "booth_record_handoff",
  consultation_booked: "booth_record_handoff",
  qr_continuation: "booth_complete_session",
};

beforeEach(() => {
  rpcCalls.length = 0;
  tableReads.length = 0;
  sessionRow.data = null;
  delete process.env.VITE_PARTNER_DEMO;
  delete process.env.VITE_DEMO_LEAD_MODE;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------------------------
 * The vocabulary split itself
 * ------------------------------------------------------------------------- */

describe("the client-observed subset is explicit, narrow and disjoint", () => {
  it("is exactly the three events the tablet is the sole witness to", () => {
    expect([...BOOTH_CLIENT_OBSERVED_EVENTS]).toEqual([
      "meaningful_conversation",
      "profile_started",
      "session_abandoned",
    ]);
  });

  it("shares nothing with the server-only set, and together they are the whole vocabulary", () => {
    const client = new Set<string>(BOOTH_CLIENT_OBSERVED_EVENTS);
    const server = new Set<string>(BOOTH_SERVER_ONLY_EVENTS);
    for (const event of client) expect(server.has(event)).toBe(false);
    expect([...client, ...server].sort()).toEqual([...BOOTH_FUNNEL_EVENTS].sort());
  });

  it("classifies every fact-establishing transition — and qr_continuation — as server-only", () => {
    for (const event of Object.keys(TRANSITION_EVENT_OWNERS)) {
      expect(`${event}:${isBoothClientObservedEvent(event)}`).toBe(`${event}:false`);
    }
    // Reserved and unemitted, but never client-observable either.
    expect(isBoothClientObservedEvent("viewing_booked")).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
 * Layer 2 — the endpoint's zod validator
 * ------------------------------------------------------------------------- */

describe("the server function validator refuses transition events", () => {
  /** The very schema the endpoint passes to `.validator(...)`. */
  const validator = async () => {
    const { boothV2RecordEventInput } = await import("./booth-v2.functions");
    return boothV2RecordEventInput;
  };

  it("accepts each client-observed event", async () => {
    const schema = await validator();
    for (const event of BOOTH_CLIENT_OBSERVED_EVENTS) {
      expect(`${event}:${schema.safeParse({ clientRef: CLIENT_REF, event }).success}`).toBe(
        `${event}:true`,
      );
    }
  });

  it("rejects every server-only event before any handler runs", async () => {
    const schema = await validator();
    for (const event of BOOTH_SERVER_ONLY_EVENTS) {
      expect(`${event}:${schema.safeParse({ clientRef: CLIENT_REF, event }).success}`).toBe(
        `${event}:false`,
      );
    }
  });

  it("rejects an unknown event name outright", async () => {
    const schema = await validator();
    expect(schema.safeParse({ clientRef: CLIENT_REF, event: "made_up" }).success).toBe(false);
  });

  it("is the schema the endpoint actually validates with", () => {
    const source = readFileSync("src/features/navigator/booth-v2/booth-v2.functions.ts", "utf8");
    const block = source.slice(source.indexOf("export const boothV2RecordEvent ="));
    expect(block.slice(0, block.indexOf("\n  .handler"))).toContain(
      ".validator(boothV2RecordEventInput)",
    );
    expect(source).toContain("event: z.enum(BOOTH_CLIENT_OBSERVED_EVENTS)");
  });
});

/* ---------------------------------------------------------------------------
 * Layer 3 — the service allowlist, and it must change nothing when it refuses
 * ------------------------------------------------------------------------- */

describe("the service allowlist refuses transition events with zero database work", () => {
  it("records each client-observed event, and replays it idempotently", async () => {
    for (const event of BOOTH_CLIENT_OBSERVED_EVENTS) {
      rpcCalls.length = 0;
      await expect(recordFunnelEvent(ACTOR, { clientRef: CLIENT_REF, event })).resolves.toEqual({
        ok: true,
      });
      await expect(recordFunnelEvent(ACTOR, { clientRef: CLIENT_REF, event })).resolves.toEqual({
        ok: true,
      });
      const recorded = rpcCalls.filter((call) => call.fn === "booth_record_event");
      expect(recorded).toHaveLength(2);
      // Both replays carry the same event and the same acting account, so the
      // database's (session_id, event) uniqueness makes them exactly-once.
      for (const call of recorded) {
        expect(call.args.p_event).toBe(event);
        expect(call.args.p_actor_user_id).toBe(ACTOR.userId);
      }
    }
  });

  it("refuses every server-only event and touches nothing at all", async () => {
    for (const event of BOOTH_SERVER_ONLY_EVENTS) {
      rpcCalls.length = 0;
      tableReads.length = 0;
      const refusal = await recordFunnelEvent(ACTOR, { clientRef: CLIENT_REF, event }).catch(
        (error: { code?: string }) => error,
      );
      expect(`${event}:${(refusal as { code?: string }).code}`).toBe(
        `${event}:booth_event_not_client_observed`,
      );
      // No session opened, no event inserted, no table read: the refusal is
      // decided before any database work is attempted.
      expect(`${event}:${JSON.stringify(rpcCalls)}`).toBe(`${event}:[]`);
      expect(`${event}:${JSON.stringify(tableReads)}`).toBe(`${event}:[]`);
    }
  });

  it("still refuses an unknown event name", async () => {
    await expect(
      recordFunnelEvent(ACTOR, { clientRef: CLIENT_REF, event: "totally_made_up" }),
    ).rejects.toMatchObject({ code: "booth_invalid_event" });
    expect(rpcCalls).toEqual([]);
  });

  it("does not open a session for a refused event even in demo no-write mode", async () => {
    process.env.VITE_PARTNER_DEMO = "true";
    await expect(
      recordFunnelEvent(ACTOR, { clientRef: CLIENT_REF, event: "whatsapp_verified" }),
    ).rejects.toMatchObject({ code: "booth_event_not_client_observed" });
    expect(rpcCalls).toEqual([]);
  });

  it("leaves a transient failure retryable rather than silently swallowed", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const client = supabaseAdmin as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
    };
    const original = client.rpc;
    let recordAttempts = 0;
    client.rpc = async (fn, args) => {
      if (fn === "booth_record_event") {
        recordAttempts += 1;
        if (recordAttempts === 1) {
          return { data: null, error: { message: "connection reset" } };
        }
      }
      return original(fn, args);
    };
    try {
      await expect(
        recordFunnelEvent(ACTOR, { clientRef: CLIENT_REF, event: "profile_started" }),
      ).rejects.toMatchObject({ code: "booth_request_failed" });
      // The retry succeeds, and the event travels exactly once per accepted call.
      await expect(
        recordFunnelEvent(ACTOR, { clientRef: CLIENT_REF, event: "profile_started" }),
      ).resolves.toEqual({ ok: true });
    } finally {
      client.rpc = original;
    }
  });
});

/* ---------------------------------------------------------------------------
 * The browser cannot even name a transition event
 * ------------------------------------------------------------------------- */

describe("the Booth UI never emits a transition event", () => {
  const navigator = () =>
    readFileSync("src/features/navigator/booth-v2/BoothV2Navigator.tsx", "utf8");

  it("routes client events through a client-observed-typed helper", () => {
    const source = navigator();
    expect(source).toContain("recordEventOnce(event: BoothClientObservedEvent");
    expect(source).not.toContain("type BoothFunnelEvent");
  });

  it("names no transition event anywhere in the shell", () => {
    const source = navigator();
    for (const event of Object.keys(TRANSITION_EVENT_OWNERS)) {
      // The event names may appear in prose comments, but never as a recorded
      // value: no `recordEventOnce("<event>")` and no `event: "<event>"`.
      expect(`${event}:${source.includes(`recordEventOnce("${event}")`)}`).toBe(`${event}:false`);
      expect(`${event}:${source.includes(`event: "${event}"`)}`).toBe(`${event}:false`);
    }
  });

  it("still records the three client-observed events it is entitled to", () => {
    const source = navigator();
    expect(source).toContain('recordEventOnce("meaningful_conversation")');
    expect(source).toContain('recordEventOnce("profile_started"');
    expect(source).toContain('recordEventOnce("session_abandoned"');
    // Abandonment on the inactivity timer goes through the same endpoint.
    expect(source).toContain('event: "session_abandoned"');
  });

  it("leaves the no-contact continuation entirely to the completion RPC", () => {
    const source = navigator();
    expect(source).not.toContain('recordEventOnce("qr_continuation")');
    expect(source).toContain('outcome: "no_contact_qr"');
  });
});

/* ---------------------------------------------------------------------------
 * Item 4 — foreign and unknown sessions are indistinguishable on the wire
 * ------------------------------------------------------------------------- */

describe("a session refusal is not enumerable", () => {
  const start = () => startWhatsappVerification(ACTOR, { clientRef: CLIENT_REF });

  beforeEach(() => {
    process.env.BOOTH_WHATSAPP_NUMBER = "+10000000000";
  });

  afterEach(() => {
    delete process.env.BOOTH_WHATSAPP_NUMBER;
  });

  it("answers an UNKNOWN client_ref with the one opaque refusal", async () => {
    sessionRow.data = null;

    await expect(start()).rejects.toMatchObject({
      code: "booth_session_unavailable",
      message: "This booth session is unavailable.",
    });
  });

  it("answers a FOREIGN client_ref with the byte-identical refusal", async () => {
    sessionRow.data = null;
    const unknown = await start().catch((error: Error) => error);

    sessionRow.data = {
      client_ref: CLIENT_REF,
      host_user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      assigned_guide_id: null,
      whatsapp: "+79990001122",
    };
    const foreign = await start().catch((error: Error) => error);

    expect((foreign as Error).name).toBe((unknown as Error).name);
    expect((foreign as Error).message).toBe((unknown as Error).message);
    expect((foreign as Error).message).toBe("This booth session is unavailable.");
  });

  it("says nothing about ownership, Hosts, existence or who does own it", async () => {
    sessionRow.data = {
      client_ref: CLIENT_REF,
      host_user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      assigned_guide_id: null,
      whatsapp: "+79990001122",
    };

    const refusal = (await start().catch((error: Error) => error)) as Error;

    expect(refusal.message).not.toMatch(/another|belongs|owner|host|exist|forbidden|different/i);
    expect(refusal.name).not.toMatch(/forbidden|not_found/);
  });

  it("collapses the database's own ownership and existence codes on the wire", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const client = supabaseAdmin as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
    };
    const original = client.rpc;
    const observed: Array<{ name: string; message: string }> = [];
    for (const internal of ["booth_session_forbidden", "booth_session_not_found"]) {
      client.rpc = async () => ({
        data: null,
        error: { message: `some prefix: ${internal} raised by plpgsql` },
      });
      const refusal = (await recordFunnelEvent(ACTOR, {
        clientRef: CLIENT_REF,
        event: "profile_started",
      }).catch((error: Error) => error)) as Error;
      observed.push({ name: refusal.name, message: refusal.message });
    }
    client.rpc = original;

    expect(observed[0]).toEqual(observed[1]);
    expect(observed[0]).toEqual({
      name: "booth_session_unavailable",
      message: "This booth session is unavailable.",
    });
  });

  it("keeps the operational distinction in the server log, never on the wire", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    sessionRow.data = {
      client_ref: CLIENT_REF,
      host_user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      assigned_guide_id: null,
      whatsapp: "+79990001122",
    };

    await start().catch(() => undefined);

    expect(logged.join("\n")).toContain("foreign_session");
  });

  it("no longer constructs or maps the old enumerable refusals", () => {
    const source = readFileSync("src/features/navigator/booth-v2/server/service.ts", "utf8");
    // Neither code is thrown directly any more...
    expect(source).not.toMatch(/new BoothError\(\s*"booth_session_(?:forbidden|not_found)"/);
    // ...nor carries its own descriptive message in the wire-message table.
    expect(source).not.toMatch(/^\s{2}booth_session_(?:forbidden|not_found):/m);
    // The internal codes survive only as normalization INPUT.
    expect(source).toContain("NON_ENUMERABLE_SESSION_CODES");
    expect(source).toContain('SESSION_UNAVAILABLE_MESSAGE = "This booth session is unavailable."');
  });
});
