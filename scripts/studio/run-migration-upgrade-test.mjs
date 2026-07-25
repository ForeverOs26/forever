#!/usr/bin/env node
/**
 * Forever Booth V2 — EXPLICIT MIGRATION-UPGRADE HARNESS (PR #102 pass 5.1).
 *
 * run-postgres-tests.mjs proves the FRESH path: an empty cluster, the whole
 * committed chain applied in one go. It cannot prove the path that actually
 * matters for the dedicated staging project, which already has
 * 20260725150000_booth_v2_pilot.sql applied and recorded, and which must be
 * upgraded in place by the additive migration without losing a row.
 *
 * This harness applies the chain in TWO stages against real PostgreSQL:
 *
 *   Stage 1 — everything up to and including 20260725150000_booth_v2_pilot.sql
 *             (exactly the Booth schema staging received at PR head 6ecfed8),
 *             then real pre-upgrade data written through the OLD API.
 *   Stage 2 — the additive 20260726120000_booth_v2_server_issued_session.sql
 *             alone, exactly as `supabase db push` would apply it to staging.
 *
 * Then it asserts, in order:
 *   1. the old creating booth_ensure_session(TEXT,UUID,TEXT,TEXT) existed;
 *   2. booth_create_session did NOT exist before the upgrade;
 *   3. after the upgrade the old signature is GONE;
 *   4. booth_create_session issues a server-side reference and creates one shell;
 *   5. the non-creating booth_ensure_session works for the owning Host;
 *   6. unknown and foreign references are refused and create NO row;
 *   7. sessions that existed BEFORE the upgrade are byte-identical afterwards,
 *      still owned, still operable, and their leads still attached;
 *   8. service_role keeps EXECUTE and no browser role gains it.
 *
 * No hosted project, no linked Supabase, no network.
 *
 * Usage: node scripts/studio/run-migration-upgrade-test.mjs
 * Exits 0 on success, non-zero on the first failed assertion or apply error.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { createCluster, errorText } from "./pg-cluster.mjs";

const REPO = process.cwd();
const MIGRATIONS_DIR = join(REPO, "supabase", "migrations");
const BOOTSTRAP = join(REPO, "scripts", "studio", "pg-bootstrap.sql");

const PILOT = "20260725150000_booth_v2_pilot.sql";
const ADDITIVE = "20260726120000_booth_v2_server_issued_session.sql";

/** Seeded by pg-bootstrap.sql; two DIFFERENT authorized staff accounts. */
const HOST_A = "b0000000-0000-0000-0000-000000000001";
const HOST_B = "b0000000-0000-0000-0000-000000000004";

const cluster = createCluster({
  prefix: "forever-booth-upgrade-",
  port: process.env.BOOTH_UPGRADE_PG_PORT ?? "55433",
});
const { psql, psqlSql, psqlScalar } = cluster;

let checks = 0;

function assert(condition, description) {
  checks += 1;
  if (!condition) throw new Error(`upgrade assertion FAILED: ${description}`);
  console.log(`[booth-upgrade]   ok  ${description}`);
}

/**
 * Assert that a statement SUCCEEDS. psql runs with ON_ERROR_STOP=1, so a
 * refusal raises here and the description is what failed.
 */
function succeeds(sql, description) {
  try {
    psqlSql(`SET ROLE service_role; ${sql}`);
  } catch (error) {
    throw new Error(`upgrade assertion FAILED: ${description}\n${errorText(error)}`);
  }
  assert(true, description);
}

/** One scalar expression, as text. */
function scalar(sql) {
  return psqlScalar(`SELECT (${sql})::TEXT`);
}

/** `boolean::TEXT` is 'true'/'false' — not psql's display form 't'/'f'. */
const isTrue = (sql) => scalar(sql) === "true";

/** Does a function with this exact argument-type list exist? */
function functionExists(signature) {
  return isTrue(`to_regprocedure('public.${signature}') IS NOT NULL`);
}

/**
 * Run `sql` expecting it to raise `code`, and prove it changed nothing: the
 * WHOLE booth_sessions table is counted before and after, so an insert under
 * ANY reference fails this check.
 */
function refusedWithoutChange(sql, code) {
  const before = scalar(
    "SELECT count(*)::TEXT || ':' || coalesce(md5(string_agg(t.client_ref || t.host_user_id::TEXT ||" +
      " t.outcome, ',' ORDER BY t.client_ref)), '-') FROM public.booth_sessions t",
  );
  let raised = false;
  try {
    psqlSql(`SET ROLE service_role; ${sql}`);
  } catch (error) {
    raised = new RegExp(code).test(errorText(error));
    if (!raised) throw error;
  }
  const after = scalar(
    "SELECT count(*)::TEXT || ':' || coalesce(md5(string_agg(t.client_ref || t.host_user_id::TEXT ||" +
      " t.outcome, ',' ORDER BY t.client_ref)), '-') FROM public.booth_sessions t",
  );
  return raised && before === after;
}

try {
  cluster.start();

  // ==========================================================================
  // STAGE 1 — the schema the dedicated staging project already has.
  // ==========================================================================
  console.log("[booth-upgrade] STAGE 1: applying the chain through the 6ecfed8 Booth schema");
  psql(BOOTSTRAP);

  const all = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const pilotIndex = all.indexOf(PILOT);
  const additiveIndex = all.indexOf(ADDITIVE);
  if (pilotIndex < 0) throw new Error(`${PILOT} is missing from ${MIGRATIONS_DIR}`);
  if (additiveIndex < 0) throw new Error(`${ADDITIVE} is missing from ${MIGRATIONS_DIR}`);
  if (additiveIndex <= pilotIndex) {
    throw new Error(`${ADDITIVE} must sort AFTER ${PILOT} — the upgrade order is wrong`);
  }

  for (const file of all.slice(0, pilotIndex + 1)) {
    if (file === "20260721120000_forever_studio_v1.sql") {
      psqlSql("GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated");
    }
    // Reproduce a Supabase project whose DEFAULT PRIVILEGES hand browser roles
    // EXECUTE on new functions, so BOTH migrations' explicit REVOKEs are under
    // test — including the additive one, whose functions are created later.
    if (file === PILOT) {
      psqlSql(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;" +
          " ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated",
      );
    }
    console.log(`[booth-upgrade]   applying ${file}`);
    psql(join(MIGRATIONS_DIR, file));
  }

  // Two authorized staff accounts. booth_sessions.host_user_id is a NOT NULL
  // reference to auth.users, so the Hosts must exist before any session does.
  // Fixture setup only — never the operation under test.
  psqlSql(
    `INSERT INTO auth.users (id, email) VALUES` +
      ` ('${HOST_A}', 'host-a@example.test'), ('${HOST_B}', 'host-b@example.test')` +
      ` ON CONFLICT (id) DO NOTHING`,
  );

  console.log("[booth-upgrade] verifying the PRE-upgrade contract");
  assert(
    functionExists("booth_ensure_session(text,uuid,text,text)"),
    "the OLD creating booth_ensure_session(TEXT,UUID,TEXT,TEXT) exists before the upgrade",
  );
  assert(
    !functionExists("booth_create_session(uuid,text,text)"),
    "booth_create_session does NOT exist before the upgrade",
  );
  assert(
    !functionExists("booth_ensure_session(text,uuid)"),
    "the non-creating booth_ensure_session(TEXT,UUID) does NOT exist before the upgrade",
  );
  assert(
    isTrue(
      "SELECT prosrc LIKE '%INSERT INTO public.booth_sessions%'" +
        " FROM pg_proc WHERE oid = 'public.booth_ensure_session(text,uuid,text,text)'::regprocedure",
    ),
    "the pre-upgrade ensure really did create sessions (this is the defect being closed)",
  );

  // --- Real pre-upgrade data, written through the OLD API. -----------------
  console.log("[booth-upgrade] writing pre-upgrade sessions through the OLD API");
  // A browser-chosen reference, exactly how the tablet did it at 6ecfed8.
  psqlSql(
    `SET ROLE service_role;` +
      ` SELECT public.booth_ensure_session('legacy-ref-0001','${HOST_A}','host-a@example.test','pilot-booth');` +
      ` SELECT public.booth_ensure_session('legacy-ref-0002','${HOST_A}','host-a@example.test','pilot-booth');` +
      ` SELECT public.booth_ensure_session('legacy-ref-0003','${HOST_B}','host-b@example.test','pilot-booth');`,
  );
  // One of them carries a full consented guest + lead, so the upgrade is tested
  // against a row with real content, not only empty shells.
  psqlSql(
    `SET ROLE service_role;` +
      ` SELECT public.booth_mark_profile_confirmed('legacy-ref-0001','${HOST_A}','quick');` +
      ` SELECT public.booth_commit_consent('legacy-ref-0001','${HOST_A}','quick',` +
      ` '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(), '[]'::jsonb, 'none',` +
      ` '{"first_name":"Legacy","whatsapp":"+79990001111","preferred_language":"English"}'::jsonb,` +
      ` '{"name":"Legacy","phone":"+79990001111","message":"m","source":"booth_v2"}'::jsonb);`,
  );
  // A terminal session, to prove the freeze survives the upgrade too.
  psqlSql(
    `SET ROLE service_role;` +
      ` SELECT public.booth_complete_session('legacy-ref-0002','${HOST_A}','no_contact_qr');`,
  );

  const beforeFingerprint = scalar(
    "SELECT md5(string_agg(t.client_ref || '|' || t.host_user_id::TEXT || '|' || t.booth_id" +
      " || '|' || t.outcome || '|' || coalesce(t.first_name,'-') || '|' || coalesce(t.lead_id::TEXT,'-')" +
      " || '|' || t.created_at::TEXT, E'\\n' ORDER BY t.client_ref)) FROM public.booth_sessions t",
  );
  const beforeCounts = scalar(
    "SELECT (SELECT count(*) FROM public.booth_sessions)::TEXT || ':' ||" +
      " (SELECT count(*) FROM public.leads)::TEXT || ':' ||" +
      " (SELECT count(*) FROM public.booth_funnel_events)::TEXT",
  );
  console.log(
    `[booth-upgrade]   pre-upgrade state ${beforeCounts} fingerprint ${beforeFingerprint}`,
  );

  // ==========================================================================
  // STAGE 2 — apply ONLY the additive migration, as staging would.
  // ==========================================================================
  console.log(`[booth-upgrade] STAGE 2: applying ONLY ${ADDITIVE}`);
  psql(join(MIGRATIONS_DIR, ADDITIVE));

  console.log("[booth-upgrade] verifying the POST-upgrade contract");
  assert(
    !functionExists("booth_ensure_session(text,uuid,text,text)"),
    "the old creating booth_ensure_session signature is GONE after the upgrade",
  );
  assert(
    functionExists("booth_ensure_session(text,uuid)"),
    "the non-creating booth_ensure_session(TEXT,UUID) exists after the upgrade",
  );
  assert(
    functionExists("booth_create_session(uuid,text,text)"),
    "booth_create_session(UUID,TEXT,TEXT) exists after the upgrade",
  );
  assert(
    isTrue(
      "SELECT prosrc NOT LIKE '%INSERT INTO%'" +
        " FROM pg_proc WHERE oid = 'public.booth_ensure_session(text,uuid)'::regprocedure",
    ),
    "the upgraded booth_ensure_session contains no INSERT at all",
  );
  assert(
    isTrue(
      "SELECT count(*) = 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace" +
        " WHERE n.nspname = 'public' AND p.proname = 'booth_ensure_session'",
    ),
    "exactly ONE booth_ensure_session overload survives — the two forms never coexist",
  );

  // --- 7. Existing sessions are untouched by the migration. ----------------
  const afterFingerprint = scalar(
    "SELECT md5(string_agg(t.client_ref || '|' || t.host_user_id::TEXT || '|' || t.booth_id" +
      " || '|' || t.outcome || '|' || coalesce(t.first_name,'-') || '|' || coalesce(t.lead_id::TEXT,'-')" +
      " || '|' || t.created_at::TEXT, E'\\n' ORDER BY t.client_ref)) FROM public.booth_sessions t",
  );
  const afterCounts = scalar(
    "SELECT (SELECT count(*) FROM public.booth_sessions)::TEXT || ':' ||" +
      " (SELECT count(*) FROM public.leads)::TEXT || ':' ||" +
      " (SELECT count(*) FROM public.booth_funnel_events)::TEXT",
  );
  assert(
    afterCounts === beforeCounts,
    `the migration created, updated or deleted nothing (${beforeCounts} -> ${afterCounts})`,
  );
  assert(
    afterFingerprint === beforeFingerprint,
    "every pre-upgrade session is byte-identical after the upgrade",
  );
  assert(
    isTrue(
      `SELECT consultation_consent AND first_name = 'Legacy' AND lead_id IS NOT NULL` +
        ` AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = booth_sessions.lead_id` +
        ` AND l.phone = '+79990001111')` +
        ` FROM public.booth_sessions WHERE client_ref = 'legacy-ref-0001'`,
    ),
    "the consented pre-upgrade session keeps its guest data and its linked lead",
  );
  assert(
    isTrue(
      `SELECT outcome = 'no_contact_qr' AND first_name IS NULL AND lead_id IS NULL` +
        ` FROM public.booth_sessions WHERE client_ref = 'legacy-ref-0002'`,
    ),
    "the terminal pre-upgrade session keeps its cleared, frozen state",
  );

  // --- 5. The Host can still continue its own pre-upgrade session. ---------
  succeeds(
    `SELECT public.booth_ensure_session('legacy-ref-0003','${HOST_B}');`,
    "the owning Host opens its PRE-upgrade session through the new ensure",
  );
  succeeds(
    `SELECT public.booth_record_event('legacy-ref-0003','${HOST_B}','meaningful_conversation',NULL,NULL);`,
    "a transition RPC still accepts a pre-upgrade, browser-chosen reference",
  );
  assert(
    isTrue(
      `SELECT count(*) = 1 FROM public.booth_funnel_events e JOIN public.booth_sessions s` +
        ` ON s.id = e.session_id WHERE s.client_ref = 'legacy-ref-0003'`,
    ),
    "a browser-chosen legacy reference is still fully operable after the upgrade",
  );
  assert(
    isTrue(
      `SELECT outcome = 'no_contact_qr' FROM public.booth_ensure_session('legacy-ref-0002','${HOST_A}')`,
    ),
    "the read-only ensure still opens a TERMINAL pre-upgrade session",
  );

  // --- 4. Creation works, and is server-issued. ----------------------------
  const created = psqlScalar(
    `SET ROLE service_role; SELECT public.booth_create_session('${HOST_A}','host-a@example.test','upgrade-booth')`,
  );
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(created),
    "booth_create_session issues a random UUID reference on the upgraded database",
  );
  assert(
    isTrue(
      `SELECT count(*) = 1 FROM public.booth_sessions WHERE client_ref = '${created}'` +
        ` AND host_user_id = '${HOST_A}' AND outcome = 'active' AND consultation_consent = FALSE` +
        ` AND profile IS NULL AND first_name IS NULL AND lead_id IS NULL`,
    ),
    "it creates exactly one empty operational shell owned by the acting Host",
  );
  const second = psqlScalar(
    `SET ROLE service_role; SELECT public.booth_create_session('${HOST_A}','host-a@example.test','upgrade-booth')`,
  );
  assert(second !== created, "two creates on the upgraded database issue DIFFERENT references");
  succeeds(
    `SELECT public.booth_ensure_session('${created}','${HOST_A}');`,
    "the owning Host opens the newly created session",
  );

  // --- 6. Unknown and foreign both refuse, and neither inserts. ------------
  assert(
    refusedWithoutChange(
      `SELECT public.booth_ensure_session('never-issued-ref-0001','${HOST_A}');`,
      "booth_session_not_found",
    ),
    "an UNKNOWN reference is refused after the upgrade and creates NO row",
  );
  assert(
    refusedWithoutChange(
      `SELECT public.booth_ensure_session('${created}','${HOST_B}');`,
      "booth_session_forbidden",
    ),
    "a FOREIGN reference is refused after the upgrade and changes NO row",
  );
  assert(
    isTrue(
      `SELECT host_user_id = '${HOST_A}' FROM public.booth_sessions WHERE client_ref = '${created}'`,
    ),
    "ownership is never transferred by a refused adoption",
  );

  // --- 8. Least privilege survives the upgrade. ----------------------------
  assert(
    isTrue(
      "SELECT has_function_privilege('service_role','public.booth_create_session(uuid,text,text)','EXECUTE')" +
        " AND has_function_privilege('service_role','public.booth_ensure_session(text,uuid)','EXECUTE')",
    ),
    "service_role keeps EXECUTE on both upgraded functions",
  );
  assert(
    isTrue(
      "SELECT NOT has_function_privilege('anon','public.booth_create_session(uuid,text,text)','EXECUTE')" +
        " AND NOT has_function_privilege('authenticated','public.booth_create_session(uuid,text,text)','EXECUTE')" +
        " AND NOT has_function_privilege('anon','public.booth_ensure_session(text,uuid)','EXECUTE')" +
        " AND NOT has_function_privilege('authenticated','public.booth_ensure_session(text,uuid)','EXECUTE')",
    ),
    "no browser role gains EXECUTE, despite hostile DEFAULT PRIVILEGES",
  );
  assert(
    isTrue(
      // PostgreSQL stores SET search_path = '' as the literal element
      // search_path="" — an exact match, so search_path=public cannot pass.
      `SELECT bool_and(p.proconfig @> ARRAY['search_path=""']) FROM pg_proc p` +
        " JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'" +
        " AND p.proname IN ('booth_create_session','booth_ensure_session')",
    ),
    "both upgraded functions keep the pinned EMPTY search_path",
  );
  assert(
    isTrue(
      "SELECT bool_and(p.prosecdef) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace" +
        " WHERE n.nspname = 'public' AND p.proname IN ('booth_create_session','booth_ensure_session')",
    ),
    "both upgraded functions are still SECURITY DEFINER",
  );

  // --- Replay: the migration is safe to apply twice. -----------------------
  console.log("[booth-upgrade] replaying the additive migration to prove idempotency");
  psql(join(MIGRATIONS_DIR, ADDITIVE));
  assert(
    functionExists("booth_create_session(uuid,text,text)") &&
      functionExists("booth_ensure_session(text,uuid)") &&
      !functionExists("booth_ensure_session(text,uuid,text,text)"),
    "a second application of the additive migration is a no-op, not an error",
  );

  console.log(`[booth-upgrade] PASS (${checks} assertions)`);
} catch (error) {
  const detail = [error.stdout, error.stderr, error.message]
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join("\n");
  console.error("[booth-upgrade] FAIL\n" + detail);
  process.exitCode = 1;
} finally {
  cluster.dispose();
}
