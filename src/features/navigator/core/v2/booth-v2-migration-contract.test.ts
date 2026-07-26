/**
 * Static security/truth contract for the Booth Mode 2.0 pilot MIGRATION CHAIN
 * (PR #102 corrective passes 1–5.1).
 *
 * Booth SQL is no longer one file. The pilot migration
 * 20260725150000_booth_v2_pilot.sql was applied to the dedicated staging
 * Supabase project during the earlier staging gate (PR head 6ecfed8), so it is
 * history and is frozen; corrective pass 5's database changes live in the
 * additive 20260726120000_booth_v2_server_issued_session.sql. This suite
 * therefore reads the ORDERED chain and asserts two different kinds of thing:
 *
 *   * per-file  — the applied file is byte-for-byte what staging got, and the
 *                 additive file changes only what pass 5 requires;
 *   * end-state — after the whole chain, the property that actually protects
 *                 the running system holds (last CREATE OR REPLACE wins).
 *
 * The behavioural checks run in the real PostgreSQL harness
 * (npm run studio:pg-test), which applies the whole committed chain to a fresh
 * cluster and then executes booth.postgres.sql, and in the upgrade harness
 * (npm run booth:migration-upgrade-test), which applies the chain in two stages
 * to prove the pre-pass-5 schema upgrades in place.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { BOOTH_FUNNEL_EVENTS } from "./funnel";

const MIGRATIONS_DIR = resolve(__dirname, "../../../../../supabase/migrations");

/** The applied-to-staging pilot migration. Frozen. */
const PILOT_FILE = "20260725150000_booth_v2_pilot.sql";
/** Corrective pass 5, layered on top of it. */
const SERVER_ISSUED_FILE = "20260726120000_booth_v2_server_issued_session.sql";

/**
 * The exact git blob id of the pilot migration at PR head 6ecfed8 — the bytes
 * that were applied to the dedicated staging project. Verifiable outside this
 * suite with:
 *
 *   git rev-parse 6ecfed8:supabase/migrations/20260725150000_booth_v2_pilot.sql
 *
 * If this test fails, an APPLIED migration has been edited. That is migration
 * drift: staging would keep the old functions while a fresh environment would
 * get new ones under the same version. Add a later migration instead.
 */
const PILOT_BLOB_SHA1 = "f785adc3181080e6d38695bef1054735a3b37585";

interface Migration {
  readonly file: string;
  /** The file exactly as committed. */
  readonly sql: string;
  /** Executable statements only — `--` lines are reference text. */
  readonly executable: string;
  /** Everything outside a function body: where a seed INSERT would have to live. */
  readonly outsideFunctionBodies: string;
}

function load(file: string): Migration {
  const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
  const executable = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  return {
    file,
    sql,
    executable,
    outsideFunctionBodies: executable.split(/AS \$\$[\s\S]*?\$\$;/g).join("\n"),
  };
}

/** Every committed migration, in the order PostgreSQL applies them. */
const chainFiles = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

/** The Booth migrations only, in application order. */
const BOOTH_FILES = [PILOT_FILE, SERVER_ISSUED_FILE];
const booth = BOOTH_FILES.map(load);
const [pilot, serverIssued] = booth;

/** The whole Booth chain, concatenated in application order. */
const chain = booth.map((migration) => migration.executable).join("\n");

/**
 * Reproduce `git hash-object` for a text file, so the pinned id above can be
 * compared against the repository without shelling out. Line endings are
 * normalised first: the committed blob is LF, and a CRLF checkout must not be
 * reported as tampering.
 */
function gitBlobSha1(text: string): string {
  const body = Buffer.from(text.replace(/\r\n/g, "\n"), "utf8");
  return createHash("sha1")
    .update(Buffer.from(`blob ${body.length}\0`, "utf8"))
    .update(body)
    .digest("hex");
}

/** The LAST migration in the chain that defines this function, or null. */
function definingMigration(name: string): Migration | null {
  for (let index = booth.length - 1; index >= 0; index -= 1) {
    if (definitionIn(booth[index], name) !== null) return booth[index];
  }
  return null;
}

/** One `CREATE OR REPLACE FUNCTION` block in one migration, or null. */
function definitionIn(migration: Migration, name: string): string | null {
  const match = migration.executable.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`),
  );
  return match?.[0] ?? null;
}

/**
 * The definition that WINS after the whole chain is applied. Later
 * CREATE OR REPLACE supersedes earlier, so the last file that defines the name
 * is the one the running database ends up with.
 */
function functionBody(name: string): string {
  const owner = definingMigration(name);
  if (!owner) expect.unreachable(`no migration in the chain defines public.${name}`);
  return definitionIn(owner, name) ?? "";
}

/** Every Booth function the chain defines anywhere. */
const DEFINED_FUNCTIONS = [
  ...new Set(
    [...chain.matchAll(/CREATE OR REPLACE FUNCTION public\.(booth_\w+)\(/g)].map(
      (match) => match[1],
    ),
  ),
].sort();

/**
 * The argument types each Booth function has AFTER the chain — the signature a
 * GRANT must name to be the one that actually applies. `booth_ensure_session`
 * is the one that changes: the four-argument creating form is dropped.
 */
const FINAL_SIGNATURES: Record<string, string> = {
  booth_emit_event: "UUID, TEXT, TEXT, TEXT",
  booth_lock_owned_session: "TEXT, UUID, BOOLEAN",
  booth_create_session: "UUID, TEXT, TEXT",
  booth_ensure_session: "TEXT, UUID",
  booth_record_event: "TEXT, UUID, TEXT, TEXT, TEXT",
  booth_mark_profile_confirmed: "TEXT, UUID, TEXT",
  booth_commit_consent: "TEXT, UUID, TEXT, JSONB, INTEGER, TIMESTAMPTZ, JSONB, TEXT, JSONB, JSONB",
  booth_set_whatsapp_state: "TEXT, UUID, TEXT, TEXT",
  booth_assign_guide: "TEXT, UUID, UUID, UUID, TEXT",
  booth_acknowledge_guide: "TEXT, UUID, TEXT",
  booth_record_handoff: "TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT",
  booth_complete_session: "TEXT, UUID, TEXT",
};

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

/**
 * MIGRATION LINEAGE (PR #102 corrective pass 5.1).
 *
 * The pilot migration is applied history. It must never be edited again, and
 * every later correction must be a separate, ordered, additive file.
 */
describe("booth V2 migration chain — lineage", () => {
  it("keeps the APPLIED pilot migration byte-for-byte as staging received it", () => {
    expect(gitBlobSha1(pilot.sql)).toBe(PILOT_BLOB_SHA1);
  });

  it("still carries the pre-pass-5 schema in the applied file, unrewritten", () => {
    // Meaning, not only bytes: the file staging holds still defines the OLD
    // four-argument creating ensure, and knows nothing about pass 5.
    expect(pilot.executable).toMatch(
      /CREATE OR REPLACE FUNCTION public\.booth_ensure_session\(\s*p_client_ref TEXT,\s*p_host_user_id UUID,\s*p_host_email TEXT,\s*p_booth_id TEXT\s*\)/,
    );
    expect(definitionIn(pilot, "booth_ensure_session")).toContain(
      "INSERT INTO public.booth_sessions",
    );
    expect(definitionIn(pilot, "booth_create_session")).toBeNull();
    expect(pilot.executable).not.toContain("gen_random_uuid()::TEXT");
  });

  it("applies the pass 5 correction strictly after it, as its own migration", () => {
    expect(chainFiles).toContain(PILOT_FILE);
    expect(chainFiles).toContain(SERVER_ISSUED_FILE);
    // Filename order IS application order, in every environment.
    expect(chainFiles.indexOf(SERVER_ISSUED_FILE)).toBeGreaterThan(chainFiles.indexOf(PILOT_FILE));
    expect([...BOOTH_FILES].sort()).toEqual(BOOTH_FILES);
    // No third Booth migration has appeared without this contract being updated.
    const boothMigrations = chainFiles.filter((name) => name.includes("booth"));
    expect(boothMigrations).toEqual(BOOTH_FILES);
  });

  it("states the applied-to-staging, never-production lineage in the new file", () => {
    // Unwrap the comment continuations, so the assertions are about the prose
    // and not about where the lines happen to break.
    const prose = serverIssued.sql.replace(/\n--\s*/g, " ");
    expect(prose).toMatch(/WAS APPLIED to the dedicated Booth staging Supabase project/);
    expect(prose).toMatch(/NEVER been applied to production/);
    // The old, now-false claim appears only as a quotation being corrected.
    expect(prose).toMatch(/never been applied to any environment.{0,120}now known to be wrong/);
  });

  it("runs each migration in a single explicit transaction", () => {
    for (const migration of booth) {
      expect(`${migration.file}:${/^BEGIN;$/m.test(migration.sql)}`).toBe(`${migration.file}:true`);
      expect(`${migration.file}:${/^COMMIT;$/m.test(migration.sql)}`).toBe(
        `${migration.file}:true`,
      );
    }
  });
});

/**
 * The additive migration is allowed to change the session-creation contract and
 * NOTHING else. An applied database must be upgradable by it without touching a
 * single Booth row.
 */
describe("booth V2 migration chain — the additive migration is narrow", () => {
  it("changes exactly two functions and drops exactly one signature", () => {
    const created = [
      ...serverIssued.executable.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g),
    ].map((match) => match[1]);
    expect(created.sort()).toEqual(["booth_create_session", "booth_ensure_session"]);

    const dropped = [
      ...serverIssued.executable.matchAll(/DROP FUNCTION[^;]*?public\.(\w+)\(/g),
    ].map((match) => match[1]);
    expect(dropped).toEqual(["booth_ensure_session"]);
    expect(serverIssued.executable).toContain(
      "DROP FUNCTION IF EXISTS public.booth_ensure_session(TEXT, UUID, TEXT, TEXT);",
    );
  });

  it("creates, alters and drops no table, column, constraint, trigger, policy or index", () => {
    for (const forbidden of [
      /CREATE TABLE/i,
      /ALTER TABLE/i,
      /DROP TABLE/i,
      /CREATE TRIGGER/i,
      /DROP TRIGGER/i,
      /CREATE POLICY/i,
      /ALTER POLICY/i,
      /DROP POLICY/i,
      /CREATE INDEX/i,
      /DROP INDEX/i,
      /ADD CONSTRAINT/i,
      /DROP CONSTRAINT/i,
      /ENABLE ROW LEVEL SECURITY/i,
      /CREATE TYPE/i,
      /CREATE EXTENSION/i,
    ]) {
      expect(`${forbidden.source}:${forbidden.test(serverIssued.executable)}`).toBe(
        `${forbidden.source}:false`,
      );
    }
  });

  it("modifies NO existing Booth data: no DML runs when it is applied", () => {
    // The only INSERT in the file is inside booth_create_session's body, which
    // runs later at the request of the trusted server — never during apply.
    expect(serverIssued.outsideFunctionBodies).not.toMatch(/INSERT INTO/i);
    expect(serverIssued.outsideFunctionBodies).not.toMatch(/\bUPDATE\s+public\./i);
    expect(serverIssued.outsideFunctionBodies).not.toMatch(/\bDELETE\s+FROM/i);
    expect(serverIssued.outsideFunctionBodies).not.toMatch(/\bTRUNCATE\b/i);
    // No guest record, lead or guide is created, updated or deleted at all.
    for (const table of ["leads", "booth_guides", "booth_funnel_events", "studio_members"]) {
      expect(`${table}:${serverIssued.outsideFunctionBodies.includes(table)}`).toBe(
        `${table}:false`,
      );
    }
  });

  it("is replayable: every statement it runs is idempotent", () => {
    expect(serverIssued.executable).toMatch(/DROP FUNCTION IF EXISTS/);
    // Every function it installs is CREATE OR REPLACE, never bare CREATE.
    expect(serverIssued.executable).not.toMatch(/CREATE FUNCTION(?! IF)/);
    // REVOKE/GRANT and COMMENT ON are idempotent by definition.
    const statements = serverIssued.outsideFunctionBodies
      // Blank the string literals first: a `;` inside a COMMENT ON text is not
      // a statement boundary.
      .replace(/'(?:[^']|'')*'/g, "''")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => part !== "BEGIN" && part !== "COMMIT");
    for (const statement of statements) {
      expect(statement).toMatch(
        /^(DROP FUNCTION IF EXISTS|CREATE OR REPLACE FUNCTION|REVOKE ALL ON FUNCTION|GRANT EXECUTE ON FUNCTION|COMMENT ON FUNCTION)/,
      );
    }
  });

  it("declares the prerequisite it needs, so both application orders are defined", () => {
    // A. staging already has the pilot migration; B. a fresh database applies
    // the pilot migration and then this one. Both reduce to the same
    // precondition, which the file names explicitly.
    expect(serverIssued.sql).toMatch(/Requires 20260725150000_booth_v2_pilot\.sql/);
    expect(serverIssued.sql).toMatch(/staging, which already has 20260725150000 recorded/);
    expect(serverIssued.sql).toMatch(/a fresh database, which applies 20260725150000 and then/);
    // It depends on objects the pilot migration creates, and creates none itself.
    expect(serverIssued.executable).toContain("public.booth_lock_owned_session(");
    expect(serverIssued.executable).toContain("INSERT INTO public.booth_sessions");
  });
});

describe("booth V2 pilot migration — structure", () => {
  it("creates the three booth tables", () => {
    expect(pilot.executable).toContain("CREATE TABLE IF NOT EXISTS public.booth_guides");
    expect(pilot.executable).toContain("CREATE TABLE IF NOT EXISTS public.booth_sessions");
    expect(pilot.executable).toContain("CREATE TABLE IF NOT EXISTS public.booth_funnel_events");
  });
});

describe("booth V2 migration chain — least privilege / anti-spoofing", () => {
  it("enables RLS on every booth table", () => {
    for (const table of ["booth_guides", "booth_sessions", "booth_funnel_events"]) {
      expect(pilot.executable).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
    }
  });

  it("explicitly REVOKEs every browser-role privilege before granting service_role", () => {
    for (const table of ["booth_guides", "booth_sessions", "booth_funnel_events"]) {
      // Explicit revokes, so an inherited default privilege cannot leave a
      // browser role with access to booth data.
      expect(pilot.executable).toContain(
        `REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`,
      );
      expect(pilot.executable).toContain(`GRANT ALL ON TABLE public.${table} TO service_role;`);
      // And no later migration hands one back.
      expect(chain).not.toMatch(
        new RegExp(`GRANT [^;]*\\b${table}\\b[^;]*(anon|authenticated)`, "i"),
      );
    }
  });

  it("creates NO policies on booth tables (internal-only pattern)", () => {
    expect(chain).not.toMatch(/CREATE POLICY[^;]*booth_/i);
  });

  it("does not touch the anonymous leads INSERT policy", () => {
    expect(chain).not.toMatch(/(CREATE|ALTER|DROP) POLICY/i);
  });

  it("restricts every privileged RPC to service_role, at its FINAL signature", () => {
    for (const [fn, signature] of Object.entries(FINAL_SIGNATURES)) {
      // The grant that applies is the one naming the surviving signature, and
      // it must live in the same migration that installed that definition —
      // otherwise a function created here would keep whatever default
      // privileges the project hands out.
      const owner = definingMigration(fn);
      expect(`${fn}:owner`).toBe(owner ? `${fn}:owner` : `${fn}:MISSING`);
      expect(
        `${fn}:${owner?.executable.includes(
          `REVOKE ALL ON FUNCTION public.${fn}(${signature}) FROM PUBLIC, anon, authenticated;`,
        )}`,
      ).toBe(`${fn}:true`);
      expect(
        `${fn}:${owner?.executable.includes(
          `GRANT EXECUTE ON FUNCTION public.${fn}(${signature}) TO service_role;`,
        )}`,
      ).toBe(`${fn}:true`);
      // No browser role is ever granted EXECUTE, in any migration.
      expect(chain).not.toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO [^;]*(anon|authenticated)`,
        ),
      );
    }
    // The trigger function is revoked too and never granted to anyone.
    expect(pilot.executable).toContain(
      "REVOKE ALL ON FUNCTION public.booth_sessions_freeze_terminal() FROM PUBLIC, anon, authenticated;",
    );
  });

  it("leaves no grant behind on the dropped creating signature", () => {
    // The pilot migration granted it; the additive migration drops the function,
    // which drops its privileges with it, and never re-grants that form.
    expect(serverIssued.executable).not.toContain(
      "GRANT EXECUTE ON FUNCTION public.booth_ensure_session(TEXT, UUID, TEXT, TEXT)",
    );
    const dropIndex = serverIssued.executable.indexOf(
      "DROP FUNCTION IF EXISTS public.booth_ensure_session(TEXT, UUID, TEXT, TEXT);",
    );
    const createIndex = serverIssued.executable.indexOf(
      "CREATE OR REPLACE FUNCTION public.booth_ensure_session(",
    );
    // Drop first, then install the replacement: the two forms never coexist
    // past this migration.
    expect(dropIndex).toBeGreaterThan(-1);
    expect(dropIndex).toBeLessThan(createIndex);
  });

  it("adds the Booth capability to the EXISTING staff roster, default off, seeding nobody", () => {
    expect(pilot.executable).toMatch(
      /ALTER TABLE public\.studio_members\s+ADD COLUMN IF NOT EXISTS can_access_booth BOOLEAN NOT NULL DEFAULT FALSE;/,
    );
    // No second identity table, and no row is granted the capability anywhere
    // in the chain.
    expect(chain).not.toMatch(/CREATE TABLE[^;]*booth_staff/i);
    expect(chain).not.toMatch(/UPDATE public\.studio_members/i);
    expect(chain).not.toMatch(/can_access_booth\s*=\s*TRUE/i);
    // Nothing else about studio_members is touched, so Studio is unchanged.
    const studioStatements = chain.match(/ALTER TABLE public\.studio_members[^;]*;/g) ?? [];
    expect(studioStatements).toHaveLength(1);
  });

  it("pins SECURITY DEFINER functions to an empty search_path with no dynamic SQL", () => {
    for (const migration of booth) {
      const definers = migration.executable.match(/SECURITY DEFINER/g) ?? [];
      const pinned = migration.executable.match(/SET search_path = ''/g) ?? [];
      expect(`${migration.file}:${pinned.length}`).toBe(`${migration.file}:${definers.length}`);
      expect(`${migration.file}:${/\bEXECUTE\s+format\(/i.test(migration.executable)}`).toBe(
        `${migration.file}:false`,
      );
    }
    expect((pilot.executable.match(/SECURITY DEFINER/g) ?? []).length).toBeGreaterThanOrEqual(11);
    expect((serverIssued.executable.match(/SECURITY DEFINER/g) ?? []).length).toBe(2);
    // Every surviving function is a pinned SECURITY DEFINER.
    for (const fn of DEFINED_FUNCTIONS) {
      const body = functionBody(fn);
      expect(`${fn}:${body.includes("SECURITY DEFINER")}`).toBe(`${fn}:true`);
      expect(`${fn}:${body.includes("SET search_path = ''")}`).toBe(`${fn}:true`);
    }
  });
});

describe("booth V2 pilot migration — server-derived identity", () => {
  it("requires a real Host account on every session and has no client host label", () => {
    expect(pilot.executable).toMatch(/host_user_id UUID NOT NULL REFERENCES auth\.users\(id\)/);
    expect(chain).not.toMatch(/host_label/);
  });

  it("links a Guide to an optional staff account for self-confirmation", () => {
    expect(pilot.executable).toMatch(/staff_user_id UUID REFERENCES auth\.users\(id\)/);
  });
});

describe("booth V2 pilot migration — truthful data constraints", () => {
  const executable = pilot.executable;

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

describe("booth V2 migration chain — session ownership", () => {
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

  it("never transfers ownership: no surviving function reassigns host_user_id", () => {
    for (const fn of DEFINED_FUNCTIONS) {
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
 * SERVER-ISSUED SESSION IDENTITY (PR #102 corrective pass 5, delivered by the
 * additive migration in pass 5.1).
 *
 * After the whole chain, exactly one function may bring a session into
 * existence, it takes no client reference, and it mints its own. Everything
 * else — ensure included — refuses an unknown reference instead of quietly
 * creating one.
 */
describe("booth V2 migration chain — server-issued session identity", () => {
  it("mints the client reference in the database and accepts none from the caller", () => {
    const body = functionBody("booth_create_session");
    // It is installed by the additive migration, not the applied one.
    expect(definitionIn(serverIssued, "booth_create_session")).toBe(body);
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
    // And it refuses outright without an authenticated Host.
    expect(body).toContain("IF p_host_user_id IS NULL THEN");
    expect(body).toContain("booth_session_forbidden");
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
    // The creating signature is dropped outright by the additive migration,
    // not merely left unused.
    expect(serverIssued.executable).toContain(
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
    // every other operation raises — and neither branch reaches a write.
    expect(body).toContain("public.booth_lock_owned_session(p_client_ref, p_actor_user_id)");
    expect(body).not.toMatch(/\bUPDATE\b/i);
    expect(body).not.toMatch(/\bDELETE\b/i);
  });

  it("leaves booth_create_session as the ONLY function that can insert a session", () => {
    // Across the END STATE of the whole chain, not one file: the pilot
    // migration's creating ensure is superseded, so it does not count.
    const creators = DEFINED_FUNCTIONS.filter((fn) =>
      /INSERT INTO public\.booth_sessions/.test(functionBody(fn)),
    );
    expect(creators).toEqual(["booth_create_session"]);
  });

  it("creates no session implicitly in any transition RPC", () => {
    for (const fn of [
      ...TRANSITION_FUNCTIONS,
      "booth_ensure_session",
      "booth_lock_owned_session",
    ]) {
      expect(`${fn}:${/INSERT INTO public\.booth_sessions/.test(functionBody(fn))}`).toBe(
        `${fn}:false`,
      );
    }
  });

  it("refuses an unknown and a foreign reference through the same gate, before any write", () => {
    const gate = functionBody("booth_lock_owned_session");
    // Both refusals are raised by the gate, and the gate's only write-capable
    // statement is the FOR UPDATE lock — a refused call changes zero rows.
    expect(gate).toContain("RAISE EXCEPTION 'booth_session_not_found'");
    expect(gate).toContain("RAISE EXCEPTION 'booth_session_forbidden'");
    expect(gate).not.toMatch(/INSERT INTO/i);
    expect(gate).not.toMatch(/\bUPDATE public\./i);
    // Every entry point that takes a client reference reaches the gate rather
    // than locating the row itself.
    for (const fn of [...TRANSITION_FUNCTIONS, "booth_ensure_session"]) {
      expect(`${fn}:${functionBody(fn).includes("booth_lock_owned_session(")}`).toBe(`${fn}:true`);
    }
  });
});

describe("booth V2 pilot migration — the consent boundary", () => {
  it("physically forbids guest data before the consultation consent", () => {
    const gate = pilot.executable.match(
      /booth_sessions_pre_consent_minimal CHECK \(([\s\S]*?)\n {2}\),/,
    );
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

describe("booth V2 migration chain — terminal immutability", () => {
  it("freezes a terminal session with a trigger the RPCs cannot bypass", () => {
    const body = functionBody("booth_sessions_freeze_terminal");
    expect(body).toContain("IF OLD.outcome <> 'active' THEN");
    expect(body).toContain("booth_session_terminal_immutable");
    expect(pilot.executable).toMatch(
      /CREATE TRIGGER booth_sessions_freeze_terminal\s+BEFORE UPDATE ON public\.booth_sessions/,
    );
    // The additive migration does not drop or replace the trigger.
    expect(serverIssued.executable).not.toMatch(/freeze_terminal/);
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
      expect(chain).toMatch(new RegExp(`booth_emit_event\\(v_session\\.id, '${event}'`));
    }
  });
});

/**
 * PR #102 corrective pass 3, item 3. `booth_record_event` is the BROWSER's event
 * entry point, so the database itself must refuse a transition event — including
 * a direct service_role call that has bypassed the TypeScript type, the zod
 * validator and the service allowlist.
 */
describe("booth V2 migration chain — the client-observed funnel allowlist", () => {
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
    expect(chain).not.toMatch(/booth_emit_event\([^)]*'viewing_booked'/);
  });

  it("keeps booth_emit_event itself unreachable from any browser role", () => {
    expect(pilot.executable).toMatch(
      /REVOKE ALL ON FUNCTION public\.booth_emit_event\([^)]*\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(pilot.executable).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.booth_emit_event\([^)]*\) TO service_role;/,
    );
  });
});

describe("booth V2 migration chain — nothing invented", () => {
  it("seeds no rows at all, in any migration (no staff, no guides, no leads)", () => {
    // INSERTs exist only inside the transaction functions; none at file level.
    for (const migration of booth) {
      expect(`${migration.file}:${/INSERT INTO/i.test(migration.outsideFunctionBodies)}`).toBe(
        `${migration.file}:false`,
      );
    }
  });

  it("contains no real phone number and no exchange rate", () => {
    for (const migration of booth) {
      // no E.164 literal anywhere, comments included
      expect(`${migration.file}:${/\+\d{8,}/.test(migration.sql)}`).toBe(`${migration.file}:false`);
      expect(`${migration.file}:${/thb_per|exchange_rate|fx_rate/i.test(migration.sql)}`).toBe(
        `${migration.file}:false`,
      );
    }
  });

  it("widens leads.email only in the NULL-tolerant direction, and only once", () => {
    expect(pilot.executable).toContain(
      "ALTER TABLE public.leads ALTER COLUMN email DROP NOT NULL;",
    );
    expect(pilot.executable).toMatch(/email IS NULL OR email ~\*/);
    expect(chain).not.toMatch(/SET NOT NULL/);
    // The additive migration does not touch leads at all.
    expect(serverIssued.executable).not.toMatch(/public\.leads/);
  });
});
