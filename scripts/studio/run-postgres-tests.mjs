#!/usr/bin/env node
/**
 * Forever Studio — disposable PostgreSQL integration runner (item 14).
 *
 * Spins up a throwaway PostgreSQL cluster, applies the prerequisites stub, the
 * COMPLETE committed migration chain in filename order (including the already-
 * applied progressive migration and additive Studio corrections), then runs
 * the behavioral assertion suite. No production connection, no linked project.
 *
 * Usage: node scripts/studio/run-postgres-tests.mjs
 * Exits 0 on success, non-zero on the first failed assertion or apply error.
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPO = process.cwd();
const MIGRATIONS_DIR = join(REPO, "supabase", "migrations");
const BOOTSTRAP = join(REPO, "scripts", "studio", "pg-bootstrap.sql");
const SUITE = join(REPO, "src", "features", "forever-studio", "tests", "studio.postgres.sql");
const BOOTH_SUITE = join(
  REPO,
  "src",
  "features",
  "navigator",
  "booth-v2",
  "tests",
  "booth.postgres.sql",
);

function findBinDir() {
  for (const base of ["/usr/lib/postgresql", "/usr/pgsql", "/opt/homebrew/opt"]) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base).sort().reverse()) {
      const bin = join(base, entry, "bin");
      if (existsSync(join(bin, "initdb")) && existsSync(join(bin, "pg_ctl"))) return bin;
    }
  }
  // Fall back to PATH.
  return "";
}

const BIN = findBinDir();
const bin = (name) => (BIN ? join(BIN, name) : name);
const WINDOWS = process.platform === "win32";
const work = mkdtempSync(join(tmpdir(), "forever-studio-pg-"));
const data = join(work, "data");
// PostgreSQL on Windows does not support the Unix-domain socket setup used by
// the POSIX runner. Keep the disposable cluster loopback-only instead.
const HOST = WINDOWS ? "127.0.0.1" : work;
const PORT = WINDOWS ? process.env.STUDIO_PG_PORT || "55432" : "";
// Detached Windows postgres children inherit pg_ctl's output handles. Avoid
// pipe handles there so execFileSync can return once pg_ctl reports ready.
const PG_CTL_OPTIONS = WINDOWS ? { stdio: "ignore" } : {};

// PostgreSQL refuses to run as root. When invoked as root (CI/containers),
// run the cluster commands as an unprivileged user (default: postgres).
const RUN_AS =
  process.env.STUDIO_PG_USER || (process.getuid && process.getuid() === 0 ? "postgres" : "");

let started = false;

if (RUN_AS) {
  // The unprivileged user must own the cluster + socket directory.
  execFileSync("chown", ["-R", `${RUN_AS}:${RUN_AS}`, work]);
  execFileSync("chmod", ["777", work]);
}

function run(cmd, args, opts = {}) {
  if (RUN_AS) {
    return execFileSync("runuser", ["-u", RUN_AS, "--", cmd, ...args], {
      stdio: "pipe",
      encoding: "utf8",
      ...opts,
    });
  }
  return execFileSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts });
}

function psqlArgs(extra) {
  return [
    "-h",
    HOST,
    ...(WINDOWS ? ["-p", PORT] : []),
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-q",
    ...extra,
  ];
}

function psql(file) {
  return run(bin("psql"), psqlArgs(["-f", file]));
}

function psqlSql(sql) {
  return run(bin("psql"), psqlArgs(["-c", sql]));
}

/** A SECOND live session (async), for real cross-session concurrency probes. */
function psqlSqlAsync(sql) {
  const args = psqlArgs(["-c", sql]);
  if (RUN_AS) {
    return execFileAsync("runuser", ["-u", RUN_AS, "--", bin("psql"), ...args], {
      encoding: "utf8",
    });
  }
  return execFileAsync(bin("psql"), args, { encoding: "utf8" });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Concurrency probes for studio_index_archive_entries (exact inventory
 * replay): two REAL sessions, session A holding the job-claim lock inside an
 * open transaction while session B attempts the same (then a divergent)
 * batch. Proves: (1) the job/archive row locks serialize writers — B blocks
 * until A commits; (2) an exact concurrent replay converges to ONE identical
 * inventory; (3) a concurrent divergent replay is rejected with the
 * deterministic conflict error and cannot ride a unique constraint into
 * silent success. The outcomes are timing-independent: even if A committed
 * first, B's expected result is identical — the elapsed-time assertion
 * additionally proves B really blocked on A's transaction.
 */
async function concurrencyProbes() {
  const JOB = "96000000-0000-0000-0000-000000000001";
  const TOKEN = "96c00000-0000-0000-0000-000000000001";
  const PA1 = "97000000-0000-0000-0000-000000000001";
  const PA2 = "97000000-0000-0000-0000-000000000002";
  const MANIFEST =
    "encode(sha256(convert_to('forever-upload-part-manifest-v2','UTF8')" +
    " || int8send(8388608::BIGINT) || int4send(8388608) || int4send(1)" +
    " || decode(repeat('7',64),'hex')),'hex')";
  const COMPOSITE = "encode(sha256(convert_to(repeat('7',64),'UTF8')),'hex')";
  const PARTS_PLANNED = `('[{"index":0,"size":null,"declaredSha256":"' || repeat('7',64) || '","sha256":null,"verified":false}]')::jsonb`;
  const walk = (archive) =>
    [
      `SELECT public.studio_update_archive_claimed('${JOB}','${TOKEN}','${archive}',` +
        `('{"status":"uploaded_unverified","observed_size":8388608,"parts":[{"index":0,"size":8388608,` +
        `"declaredSha256":"' || repeat('7',64) || '","sha256":null,"verified":false}]}')::jsonb)`,
      `SELECT public.studio_update_archive_claimed('${JOB}','${TOKEN}','${archive}','{"status":"byte_verifying"}'::jsonb)`,
      `SELECT public.studio_update_archive_claimed('${JOB}','${TOKEN}','${archive}',` +
        `('{"status":"byte_verified","archive_sha256":"' || repeat('9',64) || '","composite_sha256":"' || ${COMPOSITE} || '",` +
        `"parts":[{"index":0,"size":8388608,"declaredSha256":"' || repeat('7',64) || '","sha256":"' || repeat('7',64) || '","verified":true}]}')::jsonb)`,
    ].join("; ");
  const batch = (name) =>
    `'[{"entry_index":0,"entry_name":"${name}","display_label":"entry 1 (document)",` +
    `"category":"document","compressed_size":1,"uncompressed_size":1}]'::jsonb`;
  const indexCall = (archive, name) =>
    `SELECT public.studio_index_archive_entries('${JOB}','${TOKEN}','${archive}',${batch(name)})`;

  psqlSql(
    [
      `INSERT INTO public.studio_upload_jobs(id,created_by,creator_role,workflow,status)` +
        ` VALUES ('${JOB}','00000000-0000-0000-0000-000000000001','owner','new_development','received')`,
      `SELECT * FROM public.studio_request_job_processing('${JOB}','${TOKEN}',900)`,
      `INSERT INTO public.studio_archives(id,job_id,ordinal,file_name,manifest_sha256,declared_size,part_size,part_count,status,parts)` +
        ` VALUES ('${PA1}','${JOB}',0,'probe1.zip',${MANIFEST},8388608,8388608,1,'planned',${PARTS_PLANNED}),` +
        ` ('${PA2}','${JOB}',1,'probe2.zip',${MANIFEST},8388608,8388608,1,'planned',${PARTS_PLANNED})`,
      walk(PA1),
      walk(PA2),
    ].join("; "),
  );

  // --- Probe 1: concurrent EXACT replay converges to one inventory. -------
  const sessionA = psqlSqlAsync(
    `SET ROLE service_role; BEGIN; ${indexCall(PA1, "same.bin")}; SELECT pg_sleep(6); COMMIT;`,
  );
  await sleep(1000);
  const bStart = Date.now();
  const sessionB = await psqlSqlAsync(`SET ROLE service_role; ${indexCall(PA1, "same.bin")};`);
  const bElapsed = Date.now() - bStart;
  await sessionA;
  if (!/\bt\b/.test(sessionB.stdout)) {
    throw new Error(`concurrent exact replay did not return TRUE:\n${sessionB.stdout}`);
  }
  if (bElapsed < 1000) {
    throw new Error(
      `session B returned in ${bElapsed} ms — it never blocked on session A's job-claim lock`,
    );
  }
  const converged = psqlSql(
    `SELECT count(*) || ':' || min(entry_name) FROM public.studio_archive_entries WHERE archive_id='${PA1}'`,
  );
  if (!converged.includes("1:same.bin")) {
    throw new Error(`concurrent exact replay did not converge to one row:\n${converged}`);
  }

  // --- Probe 2: concurrent DIVERGENT replay is rejected loudly. -----------
  const sessionA2 = psqlSqlAsync(
    `SET ROLE service_role; BEGIN; ${indexCall(PA2, "true.bin")}; SELECT pg_sleep(6); COMMIT;`,
  );
  await sleep(1000);
  let conflictRejected = false;
  try {
    await psqlSqlAsync(`SET ROLE service_role; ${indexCall(PA2, "evil.bin")};`);
  } catch (error) {
    conflictRejected = /studio_archive_entries_conflict/.test(
      String(error.stderr ?? "") + String(error.stdout ?? "") + String(error.message ?? ""),
    );
    if (!conflictRejected) throw error;
  }
  await sessionA2;
  if (!conflictRejected) {
    throw new Error("concurrent divergent replay SUCCEEDED — conflicting data was accepted");
  }
  const preserved = psqlSql(
    `SELECT count(*) || ':' || min(entry_name) FROM public.studio_archive_entries WHERE archive_id='${PA2}'`,
  );
  if (!preserved.includes("1:true.bin")) {
    throw new Error(`divergent replay disturbed the winning inventory:\n${preserved}`);
  }

  psqlSql(`DELETE FROM public.studio_upload_jobs WHERE id='${JOB}'`);
  console.log(
    `[studio-pg] concurrency probes PASS (exact replay blocked ${bElapsed} ms then converged; divergent replay rejected)`,
  );
}

/**
 * Booth V2 consent-commit atomicity and cross-Host ownership probes (PR #102
 * corrective items 4 and 5): two REAL, concurrent psql sessions.
 *
 * Probe 1 — atomic consent replay. Session A holds the locked booth session row
 * inside an open transaction while session B issues the identical
 * booth_commit_consent call. Proves: (1) B blocks on A's row lock rather than
 * racing it; (2) both return the SAME lead id; (3) exactly one lead row exists;
 * (4) no unattached lead is left behind.
 *
 * Probe 2 — cross-Host ownership under contention. Session A (the owning Host)
 * holds the row lock; session B is a DIFFERENT valid staff account that knows
 * the client_ref. Proves the refusal is not a race artefact: B waits for the
 * lock, then is refused deterministically and changes nothing.
 *
 * Probe 3 — rollback. A failure after the lead write rolls the whole
 * transaction back: no consent, no contact bundle, no orphan lead.
 */
async function boothConcurrencyProbes() {
  const HOST_ID = "b0000000-0000-0000-0000-000000000001";
  const OTHER_HOST_ID = "b0000000-0000-0000-0000-000000000004";
  const REF = "ref-probe-concurrent-1";
  const consentCall = (ref, actor, extra = "") =>
    `SELECT public.booth_commit_consent('${ref}','${actor}','quick',` +
    ` '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(), '[]'::jsonb, 'none',` +
    ` '{"first_name":"Race","whatsapp":"+79990009988","preferred_language":"English"${extra}}'::jsonb,` +
    ` '{"name":"Race","phone":"+79990009988","message":"m","source":"booth_v2"}'::jsonb)`;
  const call = (extra = "") => consentCall(REF, HOST_ID, extra);

  psqlSql(`SELECT public.booth_ensure_session('${REF}','${HOST_ID}','host@example.test','probe')`);

  const sessionA = psqlSqlAsync(
    `SET ROLE service_role; BEGIN; ${call()}; SELECT pg_sleep(6); COMMIT;`,
  );
  await sleep(1000);
  const bStart = Date.now();
  const sessionB = await psqlSqlAsync(`SET ROLE service_role; ${call(',"country":"Thailand"')};`);
  const bElapsed = Date.now() - bStart;
  const aResult = await sessionA;

  if (bElapsed < 1000) {
    throw new Error(
      `booth session B returned in ${bElapsed} ms — it never blocked on session A's row lock`,
    );
  }
  const leadOf = (text) => {
    const match = String(text).match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    );
    return match ? match[0] : null;
  };
  const leadA = leadOf(aResult.stdout);
  const leadB = leadOf(sessionB.stdout);
  if (!leadA || leadA !== leadB) {
    throw new Error(`concurrent contact saves returned different leads: ${leadA} vs ${leadB}`);
  }
  const counted = psqlSql(`SELECT count(*) FROM public.leads WHERE phone='+79990009988'`);
  if (!/\b1\b/.test(counted)) {
    throw new Error(`concurrent contact saves created more than one lead:\n${counted}`);
  }
  const orphans = psqlSql(
    `SELECT count(*) FROM public.leads l WHERE l.source='booth_v2'` +
      ` AND NOT EXISTS (SELECT 1 FROM public.booth_sessions s WHERE s.lead_id = l.id)`,
  );
  if (!/\b0\b/.test(orphans)) {
    throw new Error(`unattached booth leads exist after the race:\n${orphans}`);
  }

  // --- Probe 2: a DIFFERENT Host, under real lock contention, is refused. ---
  const OWNED_REF = "ref-probe-ownership-1";
  psqlSql(
    `SELECT public.booth_ensure_session('${OWNED_REF}','${HOST_ID}','host@example.test','probe')`,
  );
  const ownerHolds = psqlSqlAsync(
    `SET ROLE service_role; BEGIN;` +
      ` SELECT public.booth_lock_owned_session('${OWNED_REF}','${HOST_ID}');` +
      ` SELECT pg_sleep(6); COMMIT;`,
  );
  await sleep(1000);
  const intruderStart = Date.now();
  let intruderRefused = false;
  try {
    await psqlSqlAsync(`SET ROLE service_role; ${consentCall(OWNED_REF, OTHER_HOST_ID)};`);
  } catch (error) {
    intruderRefused = /booth_session_forbidden/.test(
      String(error.stderr ?? "") + String(error.stdout ?? "") + String(error.message ?? ""),
    );
    if (!intruderRefused) throw error;
  }
  const intruderElapsed = Date.now() - intruderStart;
  await ownerHolds;
  if (!intruderRefused) {
    throw new Error("a different Host committed consent on another Host's session");
  }
  if (intruderElapsed < 1000) {
    throw new Error(
      `the intruder returned in ${intruderElapsed} ms — it never contended for the owner's row lock`,
    );
  }
  const untouched = psqlSql(
    `SELECT (SELECT count(*) FROM public.booth_sessions WHERE client_ref='${OWNED_REF}'` +
      ` AND consultation_consent = FALSE AND lead_id IS NULL) || ':' ||` +
      ` (SELECT count(*) FROM public.leads WHERE phone='+79990009988')`,
  );
  if (!/\b1:1\b/.test(untouched)) {
    throw new Error(`the refused cross-Host attempt changed rows:\n${untouched}`);
  }

  // --- Probe 3: a failure after the lead write rolls everything back. -------
  const ROLLBACK_REF = "ref-probe-rollback-1";
  psqlSql(
    `SELECT public.booth_ensure_session('${ROLLBACK_REF}','${HOST_ID}','host@example.test','probe')`,
  );
  let rolledBack = false;
  try {
    psqlSql(
      `SET ROLE service_role; BEGIN;` +
        ` SELECT public.booth_commit_consent('${ROLLBACK_REF}','${HOST_ID}','quick',` +
        ` '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(), '[]'::jsonb, 'none',` +
        ` '{"first_name":"Rollback","whatsapp":"+79990007766","preferred_language":"English"}'::jsonb,` +
        ` '{"name":"Rollback","phone":"+79990007766","message":"m","source":"booth_v2"}'::jsonb);` +
        // Deliberate violation inside the same transaction.
        ` UPDATE public.booth_sessions SET next_step='' WHERE client_ref='${ROLLBACK_REF}'; COMMIT;`,
    );
  } catch {
    rolledBack = true;
  }
  if (!rolledBack) throw new Error("the deliberate mid-transaction violation did not fail");
  const afterRollback = psqlSql(
    `SELECT (SELECT count(*) FROM public.leads WHERE phone='+79990007766') || ':' ||` +
      ` (SELECT count(*) FROM public.booth_sessions WHERE client_ref='${ROLLBACK_REF}' AND consultation_consent)`,
  );
  if (!/\b0:0\b/.test(afterRollback)) {
    throw new Error(`a partially applied consent commit survived the rollback:\n${afterRollback}`);
  }

  console.log(
    `[studio-pg] booth atomicity + ownership probes PASS (consent replay blocked ${bElapsed} ms then returned the same lead;` +
      ` a different Host contended ${intruderElapsed} ms and was refused; rollback left nothing)`,
  );
}

try {
  run(bin("initdb"), ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8"]);
  run(
    bin("pg_ctl"),
    [
      "-D",
      data,
      "-o",
      WINDOWS
        ? `-h ${HOST} -p ${PORT} -c fsync=off -c synchronous_commit=off`
        : `-k ${work} -c listen_addresses='' -c fsync=off -c synchronous_commit=off`,
      "-w",
      "-l",
      join(work, "log"),
      "start",
    ],
    PG_CTL_OPTIONS,
  );
  started = true;

  console.log("[studio-pg] applying bootstrap prerequisites");
  psql(BOOTSTRAP);

  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    // Supabase projects can have platform-level public-schema defaults that
    // grant browser roles table access. Reproduce that state immediately
    // before Studio creates its server-only tables; the corrective migration
    // must explicitly revoke it.
    if (file === "20260721120000_forever_studio_v1.sql") {
      psqlSql("GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated");
    }
    // Same adversarial setup for the Booth pilot, but through DEFAULT
    // PRIVILEGES so the tables and functions the migration is about to create
    // are born with browser-role access. Its explicit REVOKEs must strip them.
    if (file === "20260725150000_booth_v2_pilot.sql") {
      psqlSql(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;" +
          " ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated",
      );
    }
    console.log(`[studio-pg] applying ${file}`);
    psql(join(MIGRATIONS_DIR, file));
  }

  console.log("[studio-pg] running behavioral suite");
  const out = psql(SUITE);
  process.stdout.write(out);
  console.log("[studio-pg] running Booth V2 behavioral suite");
  process.stdout.write(psql(BOOTH_SUITE));
  console.log("[studio-pg] running cross-session concurrency probes (LA-12.23/24)");
  await concurrencyProbes();
  console.log("[studio-pg] running Booth V2 contact/lead atomicity probes");
  await boothConcurrencyProbes();
  console.log("[studio-pg] PASS");
} catch (error) {
  const detail = [error.stdout, error.stderr, error.message]
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join("\n");
  console.error("[studio-pg] FAIL\n" + detail);
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      run(bin("pg_ctl"), ["-D", data, "-w", "-m", "immediate", "stop"], PG_CTL_OPTIONS);
    } catch {
      /* best effort */
    }
  }
  rmSync(work, { recursive: true, force: true });
}
