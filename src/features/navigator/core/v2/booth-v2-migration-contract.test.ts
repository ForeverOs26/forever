/**
 * Static security/truth contract for the Booth Mode 2.0 pilot migration
 * (PR #102 corrective pass 1). Reads the committed SQL and pins the properties
 * the server boundary and the privacy model depend on. The behavioural checks
 * run in the real PostgreSQL harness (npm run studio:pg-test), which applies
 * the whole committed migration chain including this file and then executes
 * src/features/navigator/booth-v2/tests/booth.postgres.sql.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { BOOTH_FUNNEL_EVENTS } from "./funnel";

const MIGRATION_PATH = resolve(
  __dirname,
  "../../../../../supabase/migrations/20260725150000_booth_v2_pilot.sql",
);

const sql = readFileSync(MIGRATION_PATH, "utf8");
/** The executable statements only — header/DOWN comments are reference text. */
const executable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
/** Everything outside a function body: where a seed INSERT would have to live. */
const outsideFunctionBodies = executable.split(/AS \$\$[\s\S]*?\$\$;/g).join("\n");

describe("booth V2 pilot migration — structure", () => {
  it("runs in a single explicit transaction", () => {
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
  });

  it("creates the three booth tables", () => {
    expect(executable).toContain("CREATE TABLE IF NOT EXISTS public.booth_guides");
    expect(executable).toContain("CREATE TABLE IF NOT EXISTS public.booth_sessions");
    expect(executable).toContain("CREATE TABLE IF NOT EXISTS public.booth_funnel_events");
  });
});

describe("booth V2 pilot migration — least privilege / anti-spoofing", () => {
  it("enables RLS on every booth table", () => {
    for (const table of ["booth_guides", "booth_sessions", "booth_funnel_events"]) {
      expect(executable).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
    }
  });

  it("explicitly REVOKEs every browser-role privilege before granting service_role", () => {
    for (const table of ["booth_guides", "booth_sessions", "booth_funnel_events"]) {
      // Explicit revokes, so an inherited default privilege cannot leave a
      // browser role with access to booth data.
      expect(executable).toContain(
        `REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`,
      );
      expect(executable).toContain(`GRANT ALL ON TABLE public.${table} TO service_role;`);
      expect(executable).not.toMatch(
        new RegExp(`GRANT [^;]*\\b${table}\\b[^;]*(anon|authenticated)`, "i"),
      );
    }
  });

  it("creates NO policies on booth tables (internal-only pattern)", () => {
    expect(executable).not.toMatch(/CREATE POLICY[^;]*booth_/i);
  });

  it("does not touch the anonymous leads INSERT policy", () => {
    expect(executable).not.toMatch(/(CREATE|ALTER|DROP) POLICY/i);
  });

  it("restricts every privileged RPC to service_role", () => {
    const functions = [
      "booth_emit_event",
      "booth_lock_owned_session",
      "booth_create_session",
      "booth_ensure_session",
      "booth_record_event",
      "booth_mark_profile_confirmed",
      "booth_commit_consent",
      "booth_set_whatsapp_state",
      "booth_assign_guide",
      "booth_acknowledge_guide",
      "booth_record_handoff",
      "booth_complete_session",
    ];
    for (const fn of functions) {
      expect(executable).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`,
        ),
      );
      expect(executable).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`),
      );
    }
    // The trigger function is revoked too and never granted to anyone.
    expect(executable).toContain(
      "REVOKE ALL ON FUNCTION public.booth_sessions_freeze_terminal() FROM PUBLIC, anon, authenticated;",
    );
  });

  it("adds the Booth capability to the EXISTING staff roster, default off, seeding nobody", () => {
    expect(executable).toMatch(
      /ALTER TABLE public\.studio_members\s+ADD COLUMN IF NOT EXISTS can_access_booth BOOLEAN NOT NULL DEFAULT FALSE;/,
    );
    // No second identity table, and no row is granted the capability here.
    expect(executable).not.toMatch(/CREATE TABLE[^;]*booth_staff/i);
    expect(executable).not.toMatch(/UPDATE public\.studio_members/i);
    expect(executable).not.toMatch(/can_access_booth\s*=\s*TRUE/i);
    // Nothing else about studio_members is touched, so Studio is unchanged.
    const studioStatements = executable.match(/ALTER TABLE public\.studio_members[^;]*;/g) ?? [];
    expect(studioStatements).toHaveLength(1);
  });

  it("pins SECURITY DEFINER functions to an empty search_path with no dynamic SQL", () => {
    const definers = executable.match(/SECURITY DEFINER/g) ?? [];
    const pinned = executable.match(/SET search_path = ''/g) ?? [];
    expect(definers.length).toBeGreaterThanOrEqual(11);
    expect(pinned.length).toBe(definers.length);
    expect(executable).not.toMatch(/\bEXECUTE\s+format\(/i);
  });
});

describe("booth V2 pilot migration — server-derived identity", () => {
  it("requires a real Host account on every session and has no client host label", () => {
    expect(executable).toMatch(/host_user_id UUID NOT NULL REFERENCES auth\.users\(id\)/);
    expect(executable).not.toMatch(/host_label/);
  });

  it("links a Guide to an optional staff account for self-confirmation", () => {
    expect(executable).toMatch(/staff_user_id UUID REFERENCES auth\.users\(id\)/);
  });
});

describe("booth V2 pilot migration — truthful data constraints", () => {
  it("enforces the zero-to-four shortlist and its coherent mode in the database", () => {
    expect(executable).toMatch(/jsonb_array_length\(shortlist\) <= 4/);
    expect(executable).toContain("booth_sessions_shortlist_mode_coherent");
  });

  it("records each funnel event at most once per session", () => {
    expect(executable).toMatch(/UNIQUE \(session_id, event\)/);
  });

  it("keeps the funnel vocabulary in lockstep with the TypeScript contract", () => {
    for (const event of BOOTH_FUNNEL_EVENTS) {
      expect(executable).toContain(`'${event}'`);
    }
  });

  it("treats the contact bundle as all-or-nothing with format checks", () => {
    expect(executable).toContain("booth_sessions_contact_bundle");
    expect(executable).toContain("booth_sessions_email_format");
    expect(executable).toContain("booth_sessions_optional_text_nonblank");
    // The bundle branch requires a valid number, a language and the consent.
    expect(executable).toMatch(/whatsapp ~ '\^\\\+\?\[0-9\]/);
    expect(executable).toMatch(
      /AND consultation_consent\s*\n\s*AND consent_recorded_at IS NOT NULL/,
    );
  });

  it("keeps the profile and the session column agreeing about the language", () => {
    expect(executable).toContain("booth_sessions_profile_language_agrees");
  });

  it("requires full evidence for a verified WhatsApp state", () => {
    expect(executable).toContain("booth_sessions_verified_requires_evidence");
    expect(executable).toContain("booth_sessions_unverified_has_no_evidence");
  });

  it("requires attribution for every acknowledgement and first contact", () => {
    expect(executable).toContain("booth_sessions_ack_attributed");
    expect(executable).toContain("booth_sessions_first_contact_attributed");
    expect(executable).toMatch(/guide_acknowledged_method TEXT/);
    expect(executable).toMatch(/'guide_self_confirmed', 'host_observed'/);
  });

  it("keeps Guide assignment coherent (assigned_at, reserve differs, reserve needs a primary)", () => {
    expect(executable).toContain("booth_sessions_assignment_coherent");
    expect(executable).toContain("booth_sessions_reserve_requires_primary");
    expect(executable).toContain("booth_sessions_reserve_differs");
  });

  it("stores the consultation instant as a real timestamp, not free text", () => {
    expect(executable).toMatch(/consultation_scheduled_at TIMESTAMPTZ/);
    expect(executable).not.toMatch(/consultation_scheduled_for/);
    expect(executable).toContain("booth_sessions_consultation_structured");
  });

  it("gates outcome 'contacted_complete' on every required fact", () => {
    const gate = executable.match(
      /booth_sessions_contacted_complete_gate CHECK \(([\s\S]*?)\n {2}\),/,
    );
    expect(gate).not.toBeNull();
    const body = gate?.[1] ?? "";
    expect(body).toContain("profile_confirmed_at IS NOT NULL");
    expect(body).toContain("first_name IS NOT NULL");
    expect(body).toContain("whatsapp IS NOT NULL");
    expect(body).toContain("preferred_language IS NOT NULL");
    expect(body).toContain("consultation_consent");
    expect(body).toContain("consent_recorded_at IS NOT NULL");
    expect(body).toContain("whatsapp_verification_state = 'verified'");
    expect(body).toContain("assigned_guide_id IS NOT NULL");
    expect(body).toContain("guide_assigned_at IS NOT NULL");
    expect(body).toContain("next_step IS NOT NULL");
    expect(body).toContain(
      "consultation_scheduled_at IS NOT NULL OR guide_first_contact_at IS NOT NULL",
    );
  });

  it("forbids ANY retained guest or handoff data on a no-contact outcome", () => {
    const gate = executable.match(
      /booth_sessions_no_contact_retains_nothing CHECK \(([\s\S]*?)\n {2}\)\n/,
    );
    expect(gate).not.toBeNull();
    const body = gate?.[1] ?? "";
    for (const column of [
      "profile IS NULL",
      "profile_version IS NULL",
      "profile_confirmed_at IS NULL",
      "flow_mode IS NULL",
      "jsonb_array_length(shortlist) = 0",
      "shortlist_mode = 'none'",
      "guide_acknowledged_by IS NULL",
      "guide_acknowledged_method IS NULL",
      "guide_first_contact_by IS NULL",
      "guide_first_contact_method IS NULL",
      "guide_fallback_reason IS NULL",
      "consultation_timezone IS NULL",
      "whatsapp_verified_at IS NULL",
      "whatsapp_verification_method IS NULL",
      "first_name IS NULL",
      "whatsapp IS NULL",
      "last_name IS NULL",
      "email IS NULL",
      "country IS NULL",
      "preferred_contact_time IS NULL",
      "host_note IS NULL",
      "preferred_language IS NULL",
      "consultation_consent = FALSE",
      "consent_recorded_at IS NULL",
      "marketing_opt_in = FALSE",
      "whatsapp_verification_state = 'unverified'",
      "assigned_guide_id IS NULL",
      "reserve_guide_id IS NULL",
      "guide_assigned_at IS NULL",
      "guide_acknowledged_at IS NULL",
      "guide_first_contact_at IS NULL",
      "consultation_scheduled_at IS NULL",
      "next_step IS NULL",
      "lead_id IS NULL",
    ]) {
      expect(body).toContain(column);
    }
  });

  it("permits exactly one lead per booth session", () => {
    expect(executable).toMatch(/lead_id UUID UNIQUE REFERENCES public\.leads\(id\)/);
  });
});

/** The body of one CREATE OR REPLACE FUNCTION block, by name. */
function functionBody(name: string): string {
  const match = executable.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`),
  );
  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}

/** Every state-transition RPC, i.e. everything that may write a session. */
const TRANSITION_FUNCTIONS = [
  "booth_record_event",
  "booth_mark_profile_confirmed",
  "booth_commit_consent",
  "booth_set_whatsapp_state",
  "booth_assign_guide",
  "booth_acknowledge_guide",
  "booth_record_handoff",
  "booth_complete_session",
];

describe("booth V2 pilot migration — session ownership", () => {
  it("locks AND ownership-checks the session in every state-transition function", () => {
    for (const fn of TRANSITION_FUNCTIONS) {
      expect(`${fn}:${functionBody(fn).includes("booth_lock_owned_session(")}`).toBe(`${fn}:true`);
    }
  });

  it("takes the acting staff account on every state-transition function", () => {
    for (const fn of TRANSITION_FUNCTIONS) {
      expect(`${fn}:${functionBody(fn).includes("p_actor_user_id UUID")}`).toBe(`${fn}:true`);
    }
  });

  it("proves ownership against host_user_id, under the row lock, before any write", () => {
    const body = functionBody("booth_lock_owned_session");
    expect(body).toContain("WHERE client_ref = p_client_ref FOR UPDATE");
    expect(body).toContain("IF v_session.host_user_id = p_actor_user_id THEN");
    expect(body).toContain("booth_session_forbidden");
    // The narrow Guide exception is opt-in per call site and matches the
    // assigned Guide's own staff account only.
    expect(body).toContain("p_allow_assigned_guide");
    expect(body).toMatch(/staff_user_id = p_actor_user_id/);
  });

  it("never transfers ownership: no function reassigns host_user_id", () => {
    for (const fn of [...TRANSITION_FUNCTIONS, "booth_ensure_session"]) {
      expect(`${fn}:${/SET host_user_id/.test(functionBody(fn))}`).toBe(`${fn}:false`);
    }
  });

  it("grants the assigned Guide ONLY the two self-actions", () => {
    // Exactly two functions opt into the Guide exception.
    const optIn = TRANSITION_FUNCTIONS.filter((fn) =>
      functionBody(fn).includes("booth_lock_owned_session(p_client_ref, p_actor_user_id, TRUE)"),
    );
    expect(optIn.sort()).toEqual(["booth_acknowledge_guide", "booth_record_handoff"]);
    // And the handoff refuses a non-Host that tries to do anything more than
    // confirm their own first contact.
    const handoff = functionBody("booth_record_handoff");
    expect(handoff).toContain("v_session.host_user_id <> p_actor_user_id");
    expect(handoff).toContain("p_consultation_scheduled_at IS NOT NULL");
    expect(handoff).toContain("NULLIF(btrim(p_next_step), '') IS NOT NULL");
  });
});

/**
 * SERVER-ISSUED SESSION IDENTITY (PR #102 corrective pass 5).
 *
 * Exactly one function may bring a session into existence, it takes no client
 * reference, and it mints its own. Everything else — ensure included — refuses
 * an unknown reference instead of quietly creating one.
 */
describe("booth V2 pilot migration — server-issued session identity", () => {
  it("mints the client reference in the database and accepts none from the caller", () => {
    const body = functionBody("booth_create_session");
    // The signature carries the Host and the booth id only.
    expect(body).toMatch(
      /CREATE OR REPLACE FUNCTION public\.booth_create_session\(\s*p_host_user_id UUID,\s*p_host_email TEXT,\s*p_booth_id TEXT\s*\)/,
    );
    expect(body).not.toContain("p_client_ref");
    // A cryptographically random, server-side value.
    expect(body).toContain("pg_catalog.gen_random_uuid()::TEXT");
    expect(body).toContain("RETURNS TEXT");
    expect(body).toContain("SECURITY DEFINER");
    expect(body).toContain("SET search_path = ''");
  });

  it("creates exactly one session per invocation and never adopts an existing one", () => {
    const body = functionBody("booth_create_session");
    const inserts = body.match(/INSERT INTO public\.booth_sessions/g) ?? [];
    expect(inserts).toHaveLength(1);
    // No ON CONFLICT: a reference this function issued must be new, so a
    // collision is a hard error rather than a silent adoption.
    expect(body).not.toMatch(/ON CONFLICT/i);
  });

  it("writes only the operational shell, so the pre-consent CHECK still holds", () => {
    const body = functionBody("booth_create_session");
    expect(body).toContain(
      "INSERT INTO public.booth_sessions (client_ref, host_user_id, host_email, booth_id)",
    );
    for (const column of ["profile", "shortlist", "first_name", "whatsapp", "lead_id"]) {
      expect(`${column}:${body.includes(column)}`).toBe(`${column}:false`);
    }
  });

  it("makes booth_ensure_session incapable of creating a session", () => {
    const body = functionBody("booth_ensure_session");
    // The creating signature is dropped outright, not merely unused.
    expect(executable).toContain(
      "DROP FUNCTION IF EXISTS public.booth_ensure_session(TEXT, UUID, TEXT, TEXT);",
    );
    expect(body).toMatch(
      /CREATE OR REPLACE FUNCTION public\.booth_ensure_session\(\s*p_client_ref TEXT,\s*p_actor_user_id UUID\s*\)/,
    );
    // It cannot insert, and it has no Host label or booth id left to write.
    expect(body).not.toMatch(/INSERT INTO/i);
    expect(body).not.toContain("p_host_user_id");
    expect(body).not.toContain("p_booth_id");
    // Existence and ownership go through the one shared, locked gate, so an
    // unknown and a foreign reference raise the same two distinct exceptions
    // every other operation raises.
    expect(body).toContain("public.booth_lock_owned_session(p_client_ref, p_actor_user_id)");
  });

  it("leaves booth_create_session as the ONLY insert into booth_sessions", () => {
    const creators = [...TRANSITION_FUNCTIONS, "booth_ensure_session", "booth_create_session"]
      .filter((fn) => /INSERT INTO public\.booth_sessions/.test(functionBody(fn)))
      .sort();
    expect(creators).toEqual(["booth_create_session"]);
  });
});

describe("booth V2 pilot migration — the consent boundary", () => {
  it("physically forbids guest data before the consultation consent", () => {
    const gate = executable.match(/booth_sessions_pre_consent_minimal CHECK \(([\s\S]*?)\n {2}\),/);
    expect(gate).not.toBeNull();
    const body = gate?.[1] ?? "";
    expect(body).toContain("consultation_consent");
    for (const column of [
      "profile IS NULL",
      "profile_version IS NULL",
      "profile_confirmed_at IS NULL",
      "jsonb_array_length(shortlist) = 0",
      "shortlist_mode = 'none'",
      "preferred_language IS NULL",
      "first_name IS NULL",
      "whatsapp IS NULL",
      "host_note IS NULL",
      "lead_id IS NULL",
    ]) {
      expect(body).toContain(column);
    }
  });

  it("never persists the profile payload before consent", () => {
    // The pre-consent marker records the flow mode and the funnel fact ONLY.
    const body = functionBody("booth_mark_profile_confirmed");
    expect(body).toContain("SET flow_mode = p_flow_mode");
    expect(body).not.toMatch(/\bprofile\s*=/);
    expect(body).not.toMatch(/preferred_language\s*=/);
    expect(body).not.toMatch(/shortlist\s*=/);
    // It cannot even receive one.
    expect(body).not.toMatch(/p_profile\b/);
  });

  it("persists profile, shortlist, contact, consent and the lead in ONE function", () => {
    const body = functionBody("booth_commit_consent");
    for (const written of [
      "profile = p_profile",
      "shortlist = p_shortlist",
      "first_name = p_contact ->> 'first_name'",
      "consultation_consent = TRUE",
      "INSERT INTO public.leads",
      "UPDATE public.leads",
    ]) {
      expect(body).toContain(written);
    }
    expect(body).toContain("booth_lock_owned_session(");
  });
});

describe("booth V2 pilot migration — terminal immutability", () => {
  it("freezes a terminal session with a trigger the RPCs cannot bypass", () => {
    const body = functionBody("booth_sessions_freeze_terminal");
    expect(body).toContain("IF OLD.outcome <> 'active' THEN");
    expect(body).toContain("booth_session_terminal_immutable");
    expect(executable).toMatch(
      /CREATE TRIGGER booth_sessions_freeze_terminal\s+BEFORE UPDATE ON public\.booth_sessions/,
    );
  });

  it("requires an active session in every transition RPC", () => {
    for (const fn of TRANSITION_FUNCTIONS) {
      // complete_session allows the exact idempotent replay first, then this.
      expect(`${fn}:${functionBody(fn).includes("booth_session_not_active")}`).toBe(`${fn}:true`);
    }
    expect(functionBody("booth_complete_session")).toContain(
      "IF v_session.outcome = p_outcome THEN",
    );
  });
});

describe("booth V2 pilot migration — atomicity", () => {
  it("creates OR updates exactly one linked lead inside the same locked transaction", () => {
    const body = functionBody("booth_commit_consent");
    expect(body).toContain("booth_lock_owned_session(");
    expect(body).toContain("IF v_lead_id IS NOT NULL THEN");
    expect(body).toContain("UPDATE public.leads");
    expect(body).toContain("INSERT INTO public.leads");
    expect(body).toContain("SET lead_id = v_lead_id");
  });

  it("never carries a verification across a replaced WhatsApp number", () => {
    const body = functionBody("booth_commit_consent");
    expect(body).toContain("v_number_changed");
    expect(body).toMatch(/WHEN v_number_changed THEN 'unverified'/);
    expect(body).toMatch(/guide_first_contact_at = CASE\s*\n\s*WHEN v_number_changed THEN NULL/);
    expect(body).toMatch(/event IN \('whatsapp_verified', 'guide_contacted'\)/);
  });

  it("resets the previous Guide's evidence on a genuine reassignment", () => {
    const body = functionBody("booth_assign_guide");
    expect(body).toContain("v_reassigned");
    for (const cleared of [
      "guide_acknowledged_at",
      "guide_first_contact_at",
      "consultation_scheduled_at",
      "next_step",
    ]) {
      expect(body).toMatch(new RegExp(`${cleared} = CASE\\s*\\n\\s*WHEN v_reassigned THEN NULL`));
    }
    expect(body).toMatch(
      /event IN \('guide_acknowledged', 'guide_contacted', 'consultation_booked'\)/,
    );
  });

  it("clears everything and deletes the lead in one no-contact transaction", () => {
    const body = functionBody("booth_complete_session");
    expect(body).toContain("DELETE FROM public.leads WHERE id = v_lead_id");
    expect(body).toContain("outcome = 'no_contact_qr'");
    expect(body).toContain("booth_completion_blocked");
    // Every guest-specific value is cleared in the SAME statement.
    for (const cleared of [
      "profile = NULL",
      "profile_version = NULL",
      "profile_confirmed_at = NULL",
      "flow_mode = NULL",
      "shortlist = '[]'::jsonb",
      "shortlist_mode = 'none'",
      "preferred_language = NULL",
      "guide_acknowledged_by = NULL",
      "guide_acknowledged_method = NULL",
      "guide_first_contact_by = NULL",
      "guide_first_contact_method = NULL",
      "guide_fallback_reason = NULL",
      "consultation_timezone = NULL",
      "lead_id = NULL",
    ]) {
      expect(body).toContain(cleared);
    }
  });

  it("emits the transition funnel events server-side", () => {
    for (const event of [
      "profile_confirmed",
      "whatsapp_verified",
      "guide_assigned",
      "guide_acknowledged",
      "guide_contacted",
      "consultation_booked",
      "qr_continuation",
    ]) {
      expect(executable).toMatch(new RegExp(`booth_emit_event\\(v_session\\.id, '${event}'`));
    }
  });
});

/**
 * PR #102 corrective pass 3, item 3. `booth_record_event` is the BROWSER's event
 * entry point, so the database itself must refuse a transition event — including
 * a direct service_role call that has bypassed the TypeScript type, the zod
 * validator and the service allowlist.
 */
describe("booth V2 pilot migration — the client-observed funnel allowlist", () => {
  const CLIENT_OBSERVED = ["meaningful_conversation", "profile_started", "session_abandoned"];
  const TRANSITION_EVENTS = [
    "profile_confirmed",
    "whatsapp_verified",
    "guide_assigned",
    "guide_acknowledged",
    "guide_contacted",
    "consultation_booked",
    "qr_continuation",
    "viewing_booked",
  ];

  it("allows exactly the three client-observed events, and nothing else", () => {
    const body = functionBody("booth_record_event");
    const allowlist = body.match(/p_event NOT IN \(([\s\S]*?)\)/)?.[1] ?? "";
    const allowed = [...allowlist.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(allowed.sort()).toEqual([...CLIENT_OBSERVED].sort());
  });

  it("refuses a transition event BEFORE locating or locking any session row", () => {
    const body = functionBody("booth_record_event");
    const refusalIndex = body.indexOf("booth_event_not_client_observed");
    const lockIndex = body.indexOf("booth_lock_owned_session(");
    const emitIndex = body.indexOf("booth_emit_event(");
    expect(refusalIndex).toBeGreaterThan(-1);
    // The guard is the first thing the body does, so a rejected call cannot
    // insert an event, settle an outcome, or touch a session row.
    expect(refusalIndex).toBeLessThan(lockIndex);
    expect(refusalIndex).toBeLessThan(emitIndex);
    // The guard is the body's very first statement (comments are stripped from
    // `executable`, so this is the executable prefix).
    expect(body.slice(body.indexOf("BEGIN"))).toMatch(
      /^BEGIN\s*\n\s*IF p_event IS NULL OR p_event NOT IN/,
    );
  });

  it("names no transition event in its allowlist", () => {
    const body = functionBody("booth_record_event");
    const guard = body.slice(0, body.indexOf("booth_lock_owned_session("));
    for (const event of TRANSITION_EVENTS) {
      expect(`${event}:${guard.includes(`'${event}'`)}`).toBe(`${event}:false`);
    }
  });

  it("no longer treats qr_continuation as a replayable client event", () => {
    const body = functionBody("booth_record_event");
    expect(body).not.toContain("qr_continuation");
    // Only the abandoned terminal state replays its own event.
    expect(body).toMatch(/v_session\.outcome <> 'abandoned' OR p_event <> 'session_abandoned'/);
  });

  it("leaves every transition event to booth_emit_event inside its owning RPC", () => {
    const owners: Record<string, string> = {
      profile_confirmed: "booth_mark_profile_confirmed",
      whatsapp_verified: "booth_set_whatsapp_state",
      guide_assigned: "booth_assign_guide",
      guide_acknowledged: "booth_acknowledge_guide",
      guide_contacted: "booth_record_handoff",
      consultation_booked: "booth_record_handoff",
      qr_continuation: "booth_complete_session",
    };
    for (const [event, owner] of Object.entries(owners)) {
      const body = functionBody(owner);
      expect(`${event}:${body.includes(`booth_emit_event(v_session.id, '${event}'`)}`).toBe(
        `${event}:true`,
      );
    }
    // Nothing emits the reserved event, so nothing can claim it.
    expect(executable).not.toMatch(/booth_emit_event\([^)]*'viewing_booked'/);
  });

  it("keeps booth_emit_event itself unreachable from any browser role", () => {
    expect(executable).toMatch(
      /REVOKE ALL ON FUNCTION public\.booth_emit_event\([^)]*\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(executable).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.booth_emit_event\([^)]*\) TO service_role;/,
    );
  });
});

describe("booth V2 pilot migration — nothing invented", () => {
  it("seeds no rows at all (no staff, no guides, no leads)", () => {
    // INSERTs exist only inside the transaction functions; none at file level.
    expect(outsideFunctionBodies).not.toMatch(/INSERT INTO/i);
  });

  it("contains no real phone number and no exchange rate", () => {
    expect(sql).not.toMatch(/\+\d{8,}/); // no E.164 literal anywhere, comments included
    expect(sql).not.toMatch(/thb_per|exchange_rate|fx_rate/i);
  });

  it("widens leads.email only in the NULL-tolerant direction", () => {
    expect(executable).toContain("ALTER TABLE public.leads ALTER COLUMN email DROP NOT NULL;");
    expect(executable).toMatch(/email IS NULL OR email ~\*/);
    expect(executable).not.toMatch(/SET NOT NULL/);
  });
});
