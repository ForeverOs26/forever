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
      "booth_ensure_session",
      "booth_record_event",
      "booth_confirm_profile",
      "booth_set_shortlist",
      "booth_save_contact_and_lead",
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

describe("booth V2 pilot migration — atomicity", () => {
  it("locks the session row in every state-transition function", () => {
    const locks = executable.match(/WHERE client_ref = p_client_ref FOR UPDATE/g) ?? [];
    // ensure_session upserts; every other transition locks first.
    expect(locks.length).toBeGreaterThanOrEqual(8);
  });

  it("creates and links the lead inside the same locked transaction", () => {
    const fn = executable.match(
      /CREATE OR REPLACE FUNCTION public\.booth_save_contact_and_lead[\s\S]*?\$\$;/,
    );
    expect(fn).not.toBeNull();
    const body = fn?.[0] ?? "";
    expect(body).toContain("FOR UPDATE");
    expect(body).toContain("IF v_session.lead_id IS NOT NULL THEN");
    expect(body).toContain("INSERT INTO public.leads");
    expect(body).toContain("SET lead_id = v_lead_id");
  });

  it("clears everything and deletes the lead in one no-contact transaction", () => {
    const fn = executable.match(
      /CREATE OR REPLACE FUNCTION public\.booth_complete_session[\s\S]*?\$\$;/,
    );
    const body = fn?.[0] ?? "";
    expect(body).toContain("DELETE FROM public.leads WHERE id = v_lead_id");
    expect(body).toContain("outcome = 'no_contact_qr'");
    expect(body).toContain("booth_completion_blocked");
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
