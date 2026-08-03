#!/usr/bin/env node
/**
 * Disposable PostgreSQL 17 contract tests for the exceptional contained-job
 * repair template. No network, linked Supabase project, or production value is
 * used. Every identifier and byte of evidence below is synthetic.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const MIGRATIONS_DIR = join(REPO, "supabase", "migrations");
const BOOTSTRAP = join(REPO, "scripts", "studio", "pg-bootstrap.sql");
const TEMPLATE = join(REPO, "docs", "FOREVER_STUDIO_CONTAINED_R2_JOB_EXACT_ROW_REPAIR.sql");
const WINDOWS = process.platform === "win32";

function findBinDir() {
  if (WINDOWS) {
    const base = "C:\\Program Files\\PostgreSQL";
    if (existsSync(base)) {
      for (const entry of readdirSync(base).sort().reverse()) {
        const bin = join(base, entry, "bin");
        if (existsSync(join(bin, "initdb.exe")) && existsSync(join(bin, "pg_ctl.exe"))) {
          return bin;
        }
      }
    }
  }
  for (const base of ["/usr/lib/postgresql", "/usr/pgsql", "/opt/homebrew/opt"]) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base).sort().reverse()) {
      const bin = join(base, entry, "bin");
      if (existsSync(join(bin, "initdb")) && existsSync(join(bin, "pg_ctl"))) return bin;
    }
  }
  return "";
}

const BIN = findBinDir();
const bin = (name) => join(BIN, WINDOWS ? `${name}.exe` : name);
const work = mkdtempSync(join(tmpdir(), "forever-contained-repair-pg17-"));
const data = join(work, "data");
const host = WINDOWS ? "127.0.0.1" : work;
const port = WINDOWS ? process.env.STUDIO_REPAIR_PG_PORT || "55433" : "";
const runAs =
  process.env.STUDIO_PG_USER || (process.getuid && process.getuid() === 0 ? "postgres" : "");
let started = false;

if (!BIN) throw new Error("PostgreSQL 17 binaries were not found");

if (runAs) {
  execFileSync("chown", ["-R", `${runAs}:${runAs}`, work]);
  execFileSync("chmod", ["777", work]);
}

function run(command, args, options = {}) {
  if (runAs) {
    return execFileSync("runuser", ["-u", runAs, "--", command, ...args], {
      stdio: "pipe",
      encoding: "utf8",
      ...options,
    });
  }
  return execFileSync(command, args, { stdio: "pipe", encoding: "utf8", ...options });
}

function psqlArgs(extra = []) {
  return [
    "-X",
    "-h",
    host,
    ...(WINDOWS ? ["-p", port] : []),
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

function psqlFile(file, variables = {}) {
  const variableArgs = Object.entries(variables).flatMap(([name, value]) => [
    "-v",
    `${name}=${value}`,
  ]);
  return run(bin("psql"), psqlArgs([...variableArgs, "-f", file]));
}

function sql(statement, tuplesOnly = false) {
  return run(
    bin("psql"),
    psqlArgs([...(tuplesOnly ? ["-A", "-t", "-F", "|"] : []), "-c", statement]),
  ).trim();
}

const ACTOR = "f0000000-0000-0000-0000-000000000001";
const TOKEN = "f1000000-0000-0000-0000-000000000001";
const APPROVED_AT = "2026-08-03T00:00:00Z";
const ids = {
  success: "f2000000-0000-0000-0000-000000000001",
  untouched: "f2000000-0000-0000-0000-000000000002",
  absent: "f2000000-0000-0000-0000-000000000003",
  status: "f2000000-0000-0000-0000-000000000004",
  provider: "f2000000-0000-0000-0000-000000000005",
  attempt: "f2000000-0000-0000-0000-000000000006",
  result: "f2000000-0000-0000-0000-000000000007",
  retryable: "f2000000-0000-0000-0000-000000000008",
};

const facts = `{"storage":{"provider":"r2"},"projectFacts":{"name":"Disposable repair"}}`;
const files = `[{"name":"material-01.jpg","storageProvider":"r2"},{"name":"material-02.pdf","storageProvider":"r2"}]`;

function insertFixture(id) {
  sql(`
    INSERT INTO public.studio_upload_jobs (
      id, created_by, creator_role, workflow, status, facts, files, error_code, error,
      retryable, attempt_count
    ) VALUES (
      '${id}', '${ACTOR}', 'owner', 'new_development', 'failed',
      '${facts}'::jsonb, '${files}'::jsonb,
      'object_stat_failed', 'Forever could not confirm the stored objects.',
      false, 7
    )
  `);
}

function preflight(id) {
  const row = sql(
    `SELECT workflow,
            attempt_count,
            jsonb_array_length(files),
            error_code,
            encode(digest(convert_to(COALESCE(error, ''), 'UTF8'), 'sha256'), 'hex'),
            encode(digest(convert_to(facts::text, 'UTF8'), 'sha256'), 'hex'),
            encode(digest(convert_to(files::text, 'UTF8'), 'sha256'), 'hex')
       FROM public.studio_upload_jobs
      WHERE id='${id}'`,
    true,
  ).split("|");
  if (row.length !== 7) throw new Error(`preflight shape mismatch for synthetic fixture ${id}`);
  return {
    job_id: id,
    expected_workflow: row[0],
    expected_attempt_count: row[1],
    expected_file_count: row[2],
    expected_error_code: row[3],
    expected_error_sha256: row[4],
    expected_facts_sha256: row[5],
    expected_files_sha256: row[6],
    operator_actor_id: ACTOR,
    approved_at: APPROVED_AT,
  };
}

function expectTemplateFailure(variables, namedReason) {
  try {
    const output = psqlFile(TEMPLATE, variables);
    if (/contained_job_repair_(refused|rolled_back)/.test(output)) return;
    throw new Error(`${namedReason}: repair unexpectedly committed`);
  } catch (error) {
    const detail = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message ?? ""}`;
    if (!/contained_job_repair_(refused|rolled_back)/.test(detail)) throw error;
  }
}

function expectEquals(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
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
        ? `-h ${host} -p ${port} -c fsync=off -c synchronous_commit=off`
        : `-k ${work} -c listen_addresses='' -c fsync=off -c synchronous_commit=off`,
      "-w",
      "-l",
      join(work, "log"),
      "start",
    ],
    WINDOWS ? { stdio: "ignore" } : {},
  );
  started = true;

  const version = sql("SHOW server_version_num", true);
  if (!/^17\d{4}$/.test(version)) {
    throw new Error(`repair template must be tested on PostgreSQL 17, got ${version}`);
  }

  psqlFile(BOOTSTRAP);
  for (const migration of readdirSync(MIGRATIONS_DIR)
    .filter((entry) => entry.endsWith(".sql"))
    .sort()) {
    psqlFile(join(MIGRATIONS_DIR, migration));
  }

  sql(`
    INSERT INTO auth.users(id, email, email_confirmed_at)
    VALUES ('${ACTOR}', 'operator@example.invalid', now());
    INSERT INTO public.studio_members(user_id, role, email, is_active)
    VALUES ('${ACTOR}', 'owner', 'operator@example.invalid', true)
  `);

  // (38) Required explicit job parameter.
  expectTemplateFailure({}, "missing explicit job parameter");

  for (const id of Object.values(ids).filter((id) => id !== ids.absent)) insertFixture(id);

  // (26, 33-37) Exact row commits once; every logical field except retryable
  // and trigger-owned updated_at, plus every unrelated row, is preserved.
  const successBefore = sql(
    `SELECT (to_jsonb(j)-'retryable'-'updated_at')::text
       FROM public.studio_upload_jobs AS j WHERE id='${ids.success}'`,
    true,
  );
  const untouchedBefore = sql(
    `SELECT to_jsonb(j)::text FROM public.studio_upload_jobs AS j WHERE id='${ids.untouched}'`,
    true,
  );
  const jobsBefore = sql("SELECT count(*) FROM public.studio_upload_jobs", true);
  const projectsBefore = sql("SELECT count(*) FROM public.projects", true);
  const successPreflight = preflight(ids.success);
  const successOutput = psqlFile(TEMPLATE, successPreflight);
  if (!/contained_job_repair_committed affected_rows=1/.test(successOutput)) {
    throw new Error("successful repair did not report exactly one affected row");
  }
  expectEquals(
    sql(`SELECT retryable::text FROM public.studio_upload_jobs WHERE id='${ids.success}'`, true),
    "true",
    "exact row false-to-true",
  );
  expectEquals(
    sql(
      `SELECT (to_jsonb(j)-'retryable'-'updated_at')::text
         FROM public.studio_upload_jobs AS j WHERE id='${ids.success}'`,
      true,
    ),
    successBefore,
    "manifest/facts/error/attempt preservation",
  );
  expectEquals(
    sql(
      `SELECT to_jsonb(j)::text FROM public.studio_upload_jobs AS j WHERE id='${ids.untouched}'`,
      true,
    ),
    untouchedBefore,
    "unrelated job logical bytes",
  );
  expectEquals(
    sql("SELECT count(*) FROM public.studio_upload_jobs", true),
    jobsBefore,
    "job count",
  );
  expectEquals(sql("SELECT count(*) FROM public.projects", true), projectsBefore, "project count");
  expectEquals(
    sql(
      `SELECT count(*) FROM public.audit_log
        WHERE action='studio_contained_r2_job_exact_row_repair'
          AND record_id='${ids.success}'
          AND old_values='{"retryable":false}'::jsonb
          AND new_values='{"retryable":true}'::jsonb
          AND metadata->>'affected_rows'='1'
          AND metadata->>'transaction_result'='committed'`,
      true,
    ),
    "1",
    "bounded audit event",
  );

  // (27) Zero-row mismatch explicitly rolls back.
  expectTemplateFailure({ ...preflight(ids.untouched), job_id: ids.absent }, "zero-row mismatch");

  // (28-32) Each changed invariant fails and leaves repairability untouched.
  const statusParams = preflight(ids.status);
  sql(`UPDATE public.studio_upload_jobs SET status='received' WHERE id='${ids.status}'`);
  expectTemplateFailure(statusParams, "changed status");
  expectEquals(
    sql(`SELECT retryable::text FROM public.studio_upload_jobs WHERE id='${ids.status}'`, true),
    "false",
    "changed-status rollback",
  );

  const providerParams = preflight(ids.provider);
  sql(
    `UPDATE public.studio_upload_jobs
        SET facts=jsonb_set(facts, '{storage,provider}', '"supabase"')
      WHERE id='${ids.provider}'`,
  );
  expectTemplateFailure(providerParams, "changed provider");
  expectEquals(
    sql(`SELECT retryable::text FROM public.studio_upload_jobs WHERE id='${ids.provider}'`, true),
    "false",
    "changed-provider rollback",
  );

  const attemptParams = preflight(ids.attempt);
  sql(`UPDATE public.studio_upload_jobs SET attempt_count=8 WHERE id='${ids.attempt}'`);
  expectTemplateFailure(attemptParams, "changed attempt_count");
  expectEquals(
    sql(`SELECT retryable::text FROM public.studio_upload_jobs WHERE id='${ids.attempt}'`, true),
    "false",
    "changed-attempt rollback",
  );

  const resultParams = preflight(ids.result);
  sql(
    `UPDATE public.studio_upload_jobs SET result_summary='{"projectSlug":"unexpected"}'::jsonb
      WHERE id='${ids.result}'`,
  );
  expectTemplateFailure(resultParams, "existing project result");
  expectEquals(
    sql(`SELECT retryable::text FROM public.studio_upload_jobs WHERE id='${ids.result}'`, true),
    "false",
    "existing-result rollback",
  );

  const retryableParams = preflight(ids.retryable);
  sql(`UPDATE public.studio_upload_jobs SET retryable=true WHERE id='${ids.retryable}'`);
  expectTemplateFailure(retryableParams, "already retryable");

  // (40, 41) Terminal false is unclaimable; the repaired exact row is then
  // claimable by the ordinary Owner-controlled database path.
  expectEquals(
    sql(
      `SELECT count(*) FROM public.studio_request_job_processing('${ids.untouched}','${TOKEN}',900)`,
      true,
    ),
    "0",
    "terminal row unavailable before repair",
  );
  expectEquals(
    sql(
      `SELECT count(*) FROM public.studio_request_job_processing('${ids.success}','${TOKEN}',900)`,
      true,
    ),
    "1",
    "post-repair Owner Retry claim",
  );
  expectEquals(
    sql(
      `SELECT status || ':' || attempt_count FROM public.studio_upload_jobs WHERE id='${ids.success}'`,
      true,
    ),
    "processing:8",
    "post-repair claim state",
  );

  // (39, 42) Repository template has no credential, production identifier,
  // generic administration hook, or Supabase Storage fallback.
  const templateText = readFileSync(TEMPLATE, "utf8");
  if (
    /sb_secret_|service.role|eyJ[A-Za-z0-9_-]+\.|R2_SECRET|ACCESS_KEY|postgres(?:ql)?:\/\//i.test(
      templateText,
    )
  ) {
    throw new Error("repair template contains a credential-shaped value");
  }
  if (
    /storage\.objects|supabase|make any job retryable|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i.test(
      templateText,
    )
  ) {
    throw new Error("repair template introduces a generic feature or Supabase fallback");
  }
  if (!/:'job_id'::uuid/.test(templateText)) {
    throw new Error("repair template does not require a runtime exact job parameter");
  }

  console.log("[contained-repair-pg17] PASS: 17 contract assertions on disposable PostgreSQL 17");
} catch (error) {
  const detail = [error.stdout, error.stderr, error.message]
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join("\n");
  console.error(`[contained-repair-pg17] FAIL\n${detail}`);
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      run(
        bin("pg_ctl"),
        ["-D", data, "-w", "-m", "immediate", "stop"],
        WINDOWS ? { stdio: "ignore" } : {},
      );
    } catch {
      // Disposable cluster cleanup is best effort after a reported failure.
    }
  }
  rmSync(work, { recursive: true, force: true });
}
