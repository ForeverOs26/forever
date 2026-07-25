/**
 * Booth Mode 2.0 consent-boundary and session-ownership tests at the SERVICE
 * layer (PR #102 corrective items 1, 4 and 5).
 *
 * The fake service-role client records every RPC name AND its arguments, so
 * these assertions can prove what the server actually sends to the database —
 * not merely what it intends. The two claims under test are:
 *
 *   1. NOTHING about the guest leaves the tablet before the consultation
 *      consent. Confirming the profile and validating the shortlist send no
 *      answers, no note, no budget, no areas, no concerns, no language, no
 *      shortlist and no contact data.
 *   2. Every session RPC carries the acting staff account, so knowing a
 *      client_ref is never authorization.
 *
 * The database enforces both independently (booth_sessions_pre_consent_minimal
 * and booth_lock_owned_session); these tests pin the boundary that feeds it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}
const rpcCalls: RpcCall[] = [];
const tableReads: string[] = [];

/** The booth_sessions row the mocked read returns next. */
const sessionRow: { data: Record<string, unknown> | null } = { data: null };

/** What the database hands back from booth_create_session. */
const ISSUED_CLIENT_REF = "3f2a91c4-77bd-4f0e-9a1e-5c8d2b6e04af";

/** Flipped by one test to simulate a create that produced no reference. */
const createReturnsNothing = { value: false };

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
          // projects slug lookup
          in: async () => ({ data: [{ slug: "modeva" }], error: null }),
        }),
        in: async () => ({ data: [{ slug: "modeva" }], error: null }),
      }),
    };
  };
  return {
    supabaseAdmin: {
      from,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        // booth_create_session is the one RPC whose RETURN VALUE is the
        // contract: the server-issued client reference.
        const created = createReturnsNothing.value ? null : ISSUED_CLIENT_REF;
        return { data: fn === "booth_create_session" ? created : null, error: null };
      },
    },
  };
});

import {
  commitConsent,
  createSession,
  ensureSession,
  markProfileConfirmed,
  validateShortlistSelection,
} from "./server/service";
import type { BoothActor } from "./server/access";
import {
  DECISION_PROFILE_VERSION,
  statedBudget,
  type BoothContactV2,
  type DecisionProfileV2,
} from "../core/v2";

const ACTOR: BoothActor = {
  userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  email: "host@example.test",
  displayName: "Host A",
  role: "owner",
};

const CLIENT_REF = "booth-ref-0000001";

/** A guest profile full of things that must NOT be persisted before consent. */
function guestProfile(overrides: Partial<DecisionProfileV2> = {}): DecisionProfileV2 {
  return {
    profileVersion: DECISION_PROFILE_VERSION,
    flowMode: "full",
    purchasePurpose: "both",
    motivations: ["investment", "second_home"],
    goals: ["rental_income"],
    concerns: ["ownership"],
    note: "SECRET-NOTE-the guest is nervous about resale",
    budget: statedBudget(250_000, 500_000, "EUR"),
    canonicalThb: null,
    timeline: "3_6m",
    essentials: {
      propertyType: "condominium",
      bedrooms: "2",
      preferredAreas: ["SECRET-AREA-Bang Tao"],
      helpMeChooseArea: false,
      readiness: "ready",
    },
    preferredLanguage: "Русский",
    confirmedAt: "2026-07-25T10:00:00.000Z",
    ...overrides,
  };
}

function contact(overrides: Partial<BoothContactV2> = {}): BoothContactV2 {
  return {
    firstName: "Anna",
    whatsapp: "+79990001122",
    preferredLanguage: "Русский",
    lastName: "Ivanova",
    email: "anna@example.test",
    country: "Cyprus",
    preferredContactTime: "evenings",
    hostNote: "prefers WhatsApp",
    consultationConsent: true,
    marketingOptIn: false,
    ...overrides,
  };
}

/** Every value a pre-consent payload must never contain, anywhere. */
const GUEST_SECRETS = [
  "SECRET-NOTE",
  "SECRET-AREA",
  "Anna",
  "+79990001122",
  "anna@example.test",
  "Русский",
  "rental_income",
  "ownership",
  "250000",
  "modeva",
];

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  rpcCalls.length = 0;
  tableReads.length = 0;
  sessionRow.data = null;
  createReturnsNothing.value = false;
  delete process.env.VITE_PARTNER_DEMO;
  delete process.env.VITE_DEMO_LEAD_MODE;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("nothing about the guest is persisted before consent", () => {
  it("confirming the profile sends the flow mode and NOTHING else", async () => {
    await markProfileConfirmed(ACTOR, { clientRef: CLIENT_REF, profile: guestProfile() });

    const marked = rpcCalls.filter((call) => call.fn === "booth_mark_profile_confirmed");
    expect(marked).toHaveLength(1);
    expect(marked[0].args).toEqual({
      p_client_ref: CLIENT_REF,
      p_actor_user_id: ACTOR.userId,
      p_flow_mode: "full",
    });

    // Not one byte of the guest's answers reaches the database.
    const wire = JSON.stringify(rpcCalls);
    for (const secret of GUEST_SECRETS) expect(wire).not.toContain(secret);
  });

  it("confirming the profile never calls a persisting RPC", async () => {
    await markProfileConfirmed(ACTOR, { clientRef: CLIENT_REF, profile: guestProfile() });
    // Exactly one RPC. The pre-call to booth_ensure_session is gone (corrective
    // pass 5): the transition RPC already proves existence and ownership, so a
    // refused operation now touches the database once rather than twice.
    expect(rpcCalls.map((call) => call.fn)).toEqual(["booth_mark_profile_confirmed"]);
  });

  it("still refuses a malformed or tampered profile at the boundary", async () => {
    await expect(
      markProfileConfirmed(ACTOR, {
        clientRef: CLIENT_REF,
        // Full flow with a purpose its own answers do not derive.
        profile: guestProfile({ purchasePurpose: "lifestyle" }),
      }),
    ).rejects.toMatchObject({ code: "booth_profile_invalid" });
    expect(rpcCalls).toEqual([]);
  });

  it("validating the shortlist persists nothing at all", async () => {
    await validateShortlistSelection(ACTOR, {
      clientRef: CLIENT_REF,
      entries: [{ slug: "modeva", mentionedByGuest: true }],
      guidePrepares: false,
    });
    // A projects lookup proves the slug is real; no session RPC is issued.
    expect(tableReads).toEqual(["projects"]);
    expect(rpcCalls).toEqual([]);
  });

  it("refuses an unknown project without writing anything", async () => {
    await expect(
      validateShortlistSelection(ACTOR, {
        clientRef: CLIENT_REF,
        entries: [{ slug: "ghost-project", mentionedByGuest: false }],
        guidePrepares: false,
      }),
    ).rejects.toMatchObject({ code: "booth_shortlist_unknown_project" });
    expect(rpcCalls).toEqual([]);
  });

  it("creating a session stores only the operational shell and issues the reference", async () => {
    const created = await createSession(ACTOR);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("booth_create_session");
    // No client reference is sent — the argument does not exist. The Host and
    // the booth id are the only inputs, and both are server-derived.
    expect(Object.keys(rpcCalls[0].args).sort()).toEqual([
      "p_booth_id",
      "p_host_email",
      "p_host_user_id",
    ]);
    expect(rpcCalls[0].args).not.toHaveProperty("p_client_ref");
    // The reference comes back FROM the database.
    expect(created.clientRef).toBe(ISSUED_CLIENT_REF);
  });

  it("refuses a create that did not return a usable reference", async () => {
    // A silent success here would hand the tablet a reference it would then
    // replay against nothing, so it must fail loudly instead.
    createReturnsNothing.value = true;
    await expect(createSession(ACTOR)).rejects.toMatchObject({ code: "booth_request_failed" });
  });

  it("opening an existing session sends only the reference and the actor", async () => {
    await ensureSession(ACTOR, { clientRef: CLIENT_REF });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("booth_ensure_session");
    // The creating arguments are gone: ensure cannot bring a session into
    // existence, so it has no Host label and no booth id to write.
    expect(Object.keys(rpcCalls[0].args).sort()).toEqual(["p_actor_user_id", "p_client_ref"]);
  });
});

describe("the consent commit is the one and only persisting operation", () => {
  it("sends the profile, shortlist, contact and lead together", async () => {
    await commitConsent(ACTOR, {
      clientRef: CLIENT_REF,
      profile: guestProfile(),
      entries: [{ slug: "modeva", mentionedByGuest: true }],
      guidePrepares: false,
      contact: contact(),
    });

    const commit = rpcCalls.find((call) => call.fn === "booth_commit_consent");
    expect(commit).toBeDefined();
    const args = commit?.args as Record<string, unknown>;
    expect(args.p_actor_user_id).toBe(ACTOR.userId);
    expect(args.p_flow_mode).toBe("full");
    expect(args.p_profile_version).toBe(DECISION_PROFILE_VERSION);
    expect(args.p_profile_confirmed_at).toBe("2026-07-25T10:00:00.000Z");
    expect(args.p_shortlist).toEqual([{ slug: "modeva", mentionedByGuest: true }]);
    expect(args.p_shortlist_mode).toBe("guest_selected");
    expect(args.p_contact).toMatchObject({
      first_name: "Anna",
      whatsapp: "+79990001122",
      preferred_language: "Русский",
      email: "anna@example.test",
      marketing_opt_in: false,
    });
    expect(args.p_lead).toMatchObject({
      name: "Anna Ivanova",
      phone: "+79990001122",
      project_slug: "modeva",
      source: "booth_v2",
    });
  });

  it("refuses to persist anything without the explicit acknowledgement", async () => {
    await expect(
      commitConsent(ACTOR, {
        clientRef: CLIENT_REF,
        profile: guestProfile(),
        entries: [],
        guidePrepares: false,
        contact: contact({ consultationConsent: false }),
      }),
    ).rejects.toMatchObject({ code: "booth_contact_invalid" });
    expect(rpcCalls).toEqual([]);
  });

  it("refuses to persist without a confirmed profile", async () => {
    await expect(
      commitConsent(ACTOR, {
        clientRef: CLIENT_REF,
        profile: null,
        entries: [],
        guidePrepares: false,
        contact: contact(),
      }),
    ).rejects.toMatchObject({ code: "booth_profile_required" });
    expect(rpcCalls).toEqual([]);
  });

  it("refuses a draft profile that was never confirmed", async () => {
    await expect(
      commitConsent(ACTOR, {
        clientRef: CLIENT_REF,
        profile: guestProfile({ confirmedAt: null }),
        entries: [],
        guidePrepares: false,
        contact: contact(),
      }),
    ).rejects.toMatchObject({ code: "booth_profile_required" });
    expect(rpcCalls).toEqual([]);
  });

  it("refuses a contact language the confirmed profile disagrees with", async () => {
    await expect(
      commitConsent(ACTOR, {
        clientRef: CLIENT_REF,
        profile: guestProfile(),
        entries: [],
        guidePrepares: false,
        contact: contact({ preferredLanguage: "Deutsch" }),
      }),
    ).rejects.toMatchObject({ code: "booth_language_mismatch" });
    expect(rpcCalls).toEqual([]);
  });
});

describe("every session RPC carries the acting staff account", () => {
  it("threads the actor through the consent commit", async () => {
    await commitConsent(ACTOR, {
      clientRef: CLIENT_REF,
      profile: guestProfile(),
      entries: [],
      guidePrepares: false,
      contact: contact(),
    });
    expect(rpcCalls.length).toBeGreaterThan(0);
    for (const call of rpcCalls) {
      expect(`${call.fn}:${call.args.p_actor_user_id}`).toBe(`${call.fn}:${ACTOR.userId}`);
    }
  });

  it("takes the Host for a NEW session from the actor, never from the caller", async () => {
    await createSession(ACTOR);
    expect(rpcCalls[0].args.p_host_user_id).toBe(ACTOR.userId);
    expect(rpcCalls[0].args.p_host_email).toBe(ACTOR.email);
  });

  it("refuses to read a session that belongs to a different Host", async () => {
    sessionRow.data = {
      client_ref: CLIENT_REF,
      host_user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      assigned_guide_id: null,
      whatsapp: "+79990001122",
    };
    const { startWhatsappVerification } = await import("./server/service");
    process.env.BOOTH_WHATSAPP_NUMBER = "+10000000000";
    // Refused as the single non-enumerable session refusal: corrective pass 3
    // item 4 collapsed "belongs to another Host" and "does not exist" into one
    // answer, so this caller cannot learn that the session exists at all.
    // booth-funnel-integrity.test.ts proves the two are indistinguishable.
    await expect(startWhatsappVerification(ACTOR, { clientRef: CLIENT_REF })).rejects.toMatchObject(
      { code: "booth_session_unavailable" },
    );
  });
});
