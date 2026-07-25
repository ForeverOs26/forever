/**
 * Static security/truth contract for the Booth Mode 2.0 pilot migration.
 * Reads the committed SQL and pins the properties the server boundary and
 * the privacy model depend on. The behavioral check happens in the real
 * PostgreSQL runner (npm run studio:pg-test), which applies the whole
 * committed migration chain including this file.
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

  it("grants booth tables to service_role ONLY — no anon/authenticated path exists", () => {
    for (const table of ["booth_guides", "booth_sessions", "booth_funnel_events"]) {
      expect(executable).toContain(`GRANT ALL ON public.${table} TO service_role;`);
      expect(executable).not.toMatch(
        new RegExp(`GRANT [^;]*${table}[^;]*(anon|authenticated)`, "i"),
      );
    }
  });

  it("creates NO policies on booth tables (internal-only pattern)", () => {
    expect(executable).not.toMatch(/CREATE POLICY[^;]*booth_/i);
  });

  it("does not touch the anonymous leads INSERT policy", () => {
    expect(executable).not.toMatch(/(CREATE|ALTER|DROP) POLICY/i);
  });
});

describe("booth V2 pilot migration — truthful data constraints", () => {
  it("enforces the zero-to-four shortlist in the database", () => {
    expect(executable).toMatch(/jsonb_array_length\(shortlist\) <= 4/);
  });

  it("records each funnel event at most once per session", () => {
    expect(executable).toMatch(/UNIQUE \(session_id, event\)/);
  });

  it("keeps the funnel vocabulary in lockstep with the TypeScript contract", () => {
    for (const event of BOOTH_FUNNEL_EVENTS) {
      expect(executable).toContain(`'${event}'`);
    }
  });

  it("gates outcome 'contacted_complete' on profile + verification + guide + next step + time", () => {
    const gate = executable.match(
      /booth_sessions_contacted_complete_gate CHECK \(([\s\S]*?)\n {2}\),/,
    );
    expect(gate).not.toBeNull();
    const body = gate?.[1] ?? "";
    expect(body).toContain("profile_confirmed_at IS NOT NULL");
    expect(body).toContain("whatsapp_verification_state = 'verified'");
    expect(body).toContain("assigned_guide_id IS NOT NULL");
    expect(body).toContain("next_step IS NOT NULL");
    expect(body).toContain(
      "consultation_scheduled_for IS NOT NULL OR guide_first_contact_at IS NOT NULL",
    );
  });

  it("forbids stored contact data on a no-contact outcome", () => {
    expect(executable).toContain("booth_sessions_no_contact_stores_no_contact");
  });

  it("requires the consultation consent before contact data exists", () => {
    expect(executable).toContain("booth_sessions_contact_requires_consent");
  });

  it("a 'verified' WhatsApp state always carries its timestamp and method", () => {
    expect(executable).toContain("booth_sessions_verified_has_timestamp");
  });
});

describe("booth V2 pilot migration — nothing invented", () => {
  it("seeds no guide rows and no lead rows", () => {
    expect(executable).not.toMatch(/INSERT INTO/i);
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
