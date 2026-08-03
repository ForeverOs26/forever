#!/usr/bin/env node
/**
 * Disposable PostgreSQL 17 contract tests for the exceptional contained-job
 * repair template. No network, linked Supabase project, or production value is
 * used. Every identifier and byte of evidence below is synthetic.
 *
 * FOREVER-PR134-REPAIR-ISOLATION-AND-ABSOLUTE-DEADLINE-001 additions:
 *
 *   - the success fixture is the AUTHORIZED SIX-FILE SHAPE (3 project photos,
 *     1 brochure, 1 price list, 1 developer profile), with
 *     `processing_requested_at` set exactly as a job with prior automatic
 *     attempts carries it -- which is what makes the automatic lane able to
 *     take the row at all, and therefore what makes the isolation real;
 *   - the repaired row is proved to be excluded from studio_list_due_jobs and
 *     studio_count_active_jobs, and a REAL SECOND SESSION observes the row
 *     continuously across the commit and never sees an automatically eligible
 *     window;
 *   - a negative control shows that flipping only `retryable` -- the previous
 *     template's single assignment -- puts the row straight back into the
 *     automatic lane;
 *   - the full material-guard and rollback matrix runs here rather than only in
 *     an independent reviewer's expansion.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
let assertions = 0;

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

/** The same command, detached, so a second real session can run concurrently. */
function runAsync(command, args) {
  const spawned = runAs
    ? spawn("runuser", ["-u", runAs, "--", command, ...args], { stdio: "pipe" })
    : spawn(command, args, { stdio: "pipe" });
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    spawned.stdout.on("data", (chunk) => (stdout += chunk));
    spawned.stderr.on("data", (chunk) => (stderr += chunk));
    spawned.on("close", (code) => resolve({ code, stdout, stderr }));
  });
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

function id(index) {
  return `f2000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
}

// -- Synthetic manifests -----------------------------------------------------
//
// No filename, object key, byte count, or digest of any real material appears
// here. Only the routing shape the template actually inspects.

const material = (purpose, extra = {}) => ({
  storageProvider: "r2",
  materialPurpose: purpose,
  purposeSource: "owner_selected",
  status: "declared",
  ...extra,
});

/** The authorized shape: 3 project photos, 1 brochure, 1 price list, 1 profile. */
const AUTHORIZED = [
  material("project_photo"),
  material("project_photo"),
  material("project_photo"),
  material("price_list"),
  material("developer_profile"),
  material("brochure"),
];

const replaceAt = (index, value) => AUTHORIZED.map((item, at) => (at === index ? value : item));

const MANIFESTS = {
  authorized: AUTHORIZED,
  five: AUTHORIZED.slice(0, 5),
  seven: [...AUTHORIZED, material("project_photo")],
  wrongPhotoCount: replaceAt(2, material("brochure")),
  missingBrochure: replaceAt(5, material("document_legal")),
  missingPriceList: replaceAt(3, material("document_legal")),
  missingDeveloper: replaceAt(4, material("document_legal")),
  paymentPlan: replaceAt(4, material("payment_plan")),
  archive: replaceAt(5, material("project_archive")),
  unknownPurpose: replaceAt(0, material("totally_unknown_purpose")),
  absentPurpose: replaceAt(0, { storageProvider: "r2", status: "declared" }),
  nonR2: replaceAt(1, material("project_photo", { storageProvider: "supabase" })),
  wrongPurposeSource: replaceAt(3, material("price_list", { purposeSource: "filename_fallback" })),
};

const FACTS = {
  storage: { provider: "r2" },
  projectFacts: { name: "Disposable repair" },
};

let nextFixture = 0;
const fixtures = new Map();

/**
 * One synthetic contained job. `processing_requested_at` is deliberately set:
 * the real contained row has it from its earlier automatic attempts, and
 * without it neither studio_list_due_jobs nor studio_count_active_jobs would
 * ever consider the row and the isolation assertions would be vacuous.
 */
function insertFixture(name, manifest = MANIFESTS.authorized, overrides = {}) {
  nextFixture += 1;
  const jobId = id(nextFixture);
  fixtures.set(name, jobId);
  const facts = JSON.stringify(overrides.facts ?? FACTS).replaceAll("'", "''");
  const files = JSON.stringify(manifest).replaceAll("'", "''");
  sql(`
    INSERT INTO public.studio_upload_jobs (
      id, created_by, creator_role, workflow, status, facts, files, error_code, error,
      retryable, attempt_count, processing_requested_at
    ) VALUES (
      '${jobId}', '${ACTOR}', 'owner', '${overrides.workflow ?? "new_development"}', 'failed',
      '${facts}'::jsonb, '${files}'::jsonb,
      'object_stat_failed', 'Forever could not confirm the stored objects.',
      false, 7, now() - interval '2 hours'
    )
  `);
  return jobId;
}

function preflight(jobId) {
  const row = sql(
    `SELECT workflow,
            attempt_count,
            jsonb_array_length(files),
            error_code,
            encode(digest(convert_to(COALESCE(error, ''), 'UTF8'), 'sha256'), 'hex'),
            encode(digest(convert_to(facts::text, 'UTF8'), 'sha256'), 'hex'),
            encode(digest(convert_to(files::text, 'UTF8'), 'sha256'), 'hex')
       FROM public.studio_upload_jobs
      WHERE id='${jobId}'`,
    true,
  ).split("|");
  if (row.length !== 7) throw new Error(`preflight shape mismatch for synthetic fixture ${jobId}`);
  return {
    job_id: jobId,
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

function expectEquals(actual, expected, label) {
  assertions += 1;
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function rowState(jobId) {
  return sql(
    `SELECT retryable::text
            || '|' || COALESCE(facts #>> '{retry,automatic}', '(absent)')
            || '|' || status
            || '|' || attempt_count
            || '|' || encode(digest(convert_to(facts::text, 'UTF8'), 'sha256'), 'hex')
            || '|' || encode(digest(convert_to(files::text, 'UTF8'), 'sha256'), 'hex')
       FROM public.studio_upload_jobs WHERE id='${jobId}'`,
    true,
  );
}

function auditCount(jobId) {
  return sql(
    `SELECT count(*) FROM public.audit_log
      WHERE action='studio_contained_r2_job_exact_row_repair' AND record_id='${jobId}'`,
    true,
  );
}

/** Rolls back, exits nonzero, changes nothing, and writes no audit event. */
function expectRepairRefused(variables, label, overrides = {}) {
  const params = { ...variables, ...overrides };
  const jobId = params.job_id;
  const before = jobId ? rowState(jobId) : null;
  let refused = false;
  try {
    const output = psqlFile(TEMPLATE, params);
    refused = /contained_job_repair_(refused|rolled_back)/.test(output);
  } catch (error) {
    const detail = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message ?? ""}`;
    // A refusal is either the template's own explicit path or a guard that
    // rejects the parameters before the transaction can reach the UPDATE.
    refused =
      /contained_job_repair_(refused|rolled_back)/.test(detail) ||
      /violates check constraint/.test(detail);
    if (!refused) throw error;
  }
  assertions += 1;
  if (!refused) throw new Error(`${label}: repair unexpectedly committed`);
  if (jobId) {
    expectEquals(rowState(jobId), before, `${label}: row unchanged after refusal`);
    expectEquals(auditCount(jobId), "0", `${label}: no audit event after refusal`);
  }
}

const DUE_FOR = (jobId) =>
  `SELECT count(*) FROM public.studio_list_due_jobs(clock_timestamp(), 100, '${ACTOR}') AS d
    WHERE d.id='${jobId}'`;

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

  sql(`
    CREATE TABLE public.repair_race_observations (
      iterations integer NOT NULL,
      max_due integer NOT NULL,
      max_active bigint NOT NULL,
      saw_retryable_false boolean NOT NULL,
      saw_retryable_true boolean NOT NULL,
      saw_automatically_eligible boolean NOT NULL
    );
    CREATE TABLE public.scheduler_claim_attempts (
      claimed integer NOT NULL
    );
  `);

  // (38) Required explicit job parameter.
  expectRepairRefused({}, "missing explicit job parameter");

  const success = insertFixture("success");
  const untouched = insertFixture("untouched");
  const absent = id(9000);

  // ---------------------------------------------------------------------
  // (29) The authorized six-file manifest succeeds -- once, atomically, and
  // without adding the row to the automatic lane.
  // ---------------------------------------------------------------------
  const successBefore = sql(
    `SELECT (to_jsonb(j)-'retryable'-'facts'-'updated_at')::text
       FROM public.studio_upload_jobs AS j WHERE id='${success}'`,
    true,
  );
  const factsBeforeWithoutRetry = sql(
    `SELECT (facts - 'retry')::text FROM public.studio_upload_jobs WHERE id='${success}'`,
    true,
  );
  const untouchedBefore = sql(
    `SELECT to_jsonb(j)::text FROM public.studio_upload_jobs AS j WHERE id='${untouched}'`,
    true,
  );
  const jobsBefore = sql("SELECT count(*) FROM public.studio_upload_jobs", true);
  const projectsBefore = sql("SELECT count(*) FROM public.projects", true);
  const activeBefore = sql(`SELECT public.studio_count_active_jobs('${ACTOR}')`, true);

  // Pre-repair the row is terminal, so neither lane can see it.
  expectEquals(sql(DUE_FOR(success), true), "0", "pre-repair due exclusion");

  const successParams = preflight(success);
  expectEquals(successParams.expected_file_count, "6", "authorized fixture file count");

  // A real second session watches the row continuously across the commit.
  const racePath = join(work, "observer.sql");
  writeFileSync(
    racePath,
    `DO $observe$
DECLARE
  deadline timestamptz := clock_timestamp() + interval '5 seconds';
  v_retryable boolean;
  v_automatic text;
  v_due integer;
  v_active bigint;
  iterations integer := 0;
  max_due integer := 0;
  max_active bigint := 0;
  saw_false boolean := false;
  saw_true boolean := false;
  saw_eligible boolean := false;
BEGIN
  LOOP
    EXIT WHEN clock_timestamp() > deadline;
    -- READ COMMITTED: every statement in this loop takes a fresh snapshot, so
    -- the repair's COMMIT becomes visible mid-loop.
    SELECT retryable, facts #>> '{retry,automatic}'
      INTO v_retryable, v_automatic
      FROM public.studio_upload_jobs WHERE id = '${success}';
    SELECT count(*) INTO v_due
      FROM public.studio_list_due_jobs(clock_timestamp(), 100, '${ACTOR}') AS d
     WHERE d.id = '${success}';
    v_active := public.studio_count_active_jobs('${ACTOR}');
    iterations := iterations + 1;
    IF v_retryable THEN saw_true := true; ELSE saw_false := true; END IF;
    IF v_retryable AND COALESCE(v_automatic, 'eligible') <> 'exhausted' THEN
      saw_eligible := true;
    END IF;
    IF v_due > max_due THEN max_due := v_due; END IF;
    IF v_active > max_active THEN max_active := v_active; END IF;
    PERFORM pg_sleep(0.005);
  END LOOP;
  INSERT INTO public.repair_race_observations
  VALUES (iterations, max_due, max_active, saw_false, saw_true, saw_eligible);
END
$observe$;
`,
    "utf8",
  );

  const observer = runAsync(bin("psql"), psqlArgs(["-f", racePath]));
  await new Promise((resolve) => setTimeout(resolve, 900));
  const successOutput = psqlFile(TEMPLATE, successParams);
  if (
    !/contained_job_repair_committed affected_rows=1 automatic_retry=exhausted/.test(successOutput)
  ) {
    throw new Error("successful repair did not report one affected row and the exhausted state");
  }
  const observed = await observer;
  if (observed.code !== 0) {
    throw new Error(`concurrent observer failed\n${observed.stdout}\n${observed.stderr}`);
  }

  // (17, 18, 23) Atomic transition, seen from a genuinely concurrent session.
  const race = sql(
    `SELECT iterations || '|' || max_due || '|' || max_active || '|' ||
            saw_retryable_false::text || '|' || saw_retryable_true::text || '|' ||
            saw_automatically_eligible::text
       FROM public.repair_race_observations`,
    true,
  ).split("|");
  assertions += 1;
  if (Number(race[0]) < 10) {
    throw new Error(`concurrent observer sampled too few times: ${race[0]}`);
  }
  expectEquals(race[1], "0", "concurrent observer never saw the repaired job due");
  expectEquals(race[2], activeBefore, "concurrent observer never saw the active count rise");
  expectEquals(race[3], "true", "concurrent observer spanned the pre-repair state");
  expectEquals(race[4], "true", "concurrent observer spanned the post-repair state");
  expectEquals(race[5], "false", "no automatically eligible window existed after the repair");

  expectEquals(
    sql(
      `SELECT retryable::text || '|' || COALESCE(facts #>> '{retry,automatic}', '(absent)')
         FROM public.studio_upload_jobs WHERE id='${success}'`,
      true,
    ),
    "true|exhausted",
    "(17) retryable and automatic exhaustion committed together",
  );
  expectEquals(
    sql(
      `SELECT public.studio_job_automatic_retry_exhausted(facts)::text
         FROM public.studio_upload_jobs WHERE id='${success}'`,
      true,
    ),
    "true",
    "database reads the repaired row as automatically exhausted",
  );

  // (24) attempt_count and every other field survive the repair.
  expectEquals(
    sql(
      `SELECT (to_jsonb(j)-'retryable'-'facts'-'updated_at')::text
         FROM public.studio_upload_jobs AS j WHERE id='${success}'`,
      true,
    ),
    successBefore,
    "(24) manifest/attempt/error/telemetry preservation",
  );
  expectEquals(
    sql(
      `SELECT (facts - 'retry')::text FROM public.studio_upload_jobs WHERE id='${success}'`,
      true,
    ),
    factsBeforeWithoutRetry,
    "every facts key except retry is unchanged",
  );
  expectEquals(
    sql(
      `SELECT to_jsonb(j)::text FROM public.studio_upload_jobs AS j WHERE id='${untouched}'`,
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
  expectEquals(auditCount(success), "1", "bounded audit event");
  expectEquals(
    sql(
      `SELECT count(*) FROM public.audit_log
        WHERE action='studio_contained_r2_job_exact_row_repair'
          AND record_id='${success}'
          AND old_values->>'retryable'='false'
          AND new_values->>'retryable'='true'
          AND new_values->>'automatic_retry'='exhausted'
          AND metadata->>'affected_rows'='1'
          AND metadata->>'transaction_result'='committed'`,
      true,
    ),
    "1",
    "audit event records both halves of the transition",
  );

  // (19, 20, 21) The repaired row is invisible to the automatic lane.
  expectEquals(sql(DUE_FOR(success), true), "0", "(19) repaired row excluded from due jobs");
  expectEquals(
    sql(`SELECT public.studio_count_active_jobs('${ACTOR}')`, true),
    activeBefore,
    "(20) repaired row excluded from the active count",
  );
  expectEquals(
    sql(
      `SELECT count(*) FROM public.studio_list_due_jobs(clock_timestamp(), 100, NULL) AS d
        WHERE d.id='${success}'`,
      true,
    ),
    "0",
    "(21) global scheduler selection excludes the repaired row",
  );

  // ---------------------------------------------------------------------
  // (23) A real scheduler session and the Owner's Retry race. Only the Owner
  // can start work, and attempt_count moves exactly once.
  // ---------------------------------------------------------------------
  const schedulerPath = join(work, "scheduler.sql");
  writeFileSync(
    schedulerPath,
    `DO $scheduler$
DECLARE
  deadline timestamptz := clock_timestamp() + interval '4 seconds';
  due_job public.studio_upload_jobs%ROWTYPE;
  claimed integer := 0;
BEGIN
  LOOP
    EXIT WHEN clock_timestamp() > deadline;
    FOR due_job IN
      SELECT * FROM public.studio_list_due_jobs(clock_timestamp(), 5, NULL)
    LOOP
      -- The scheduled runner's own budget check, mirrored from service.ts.
      CONTINUE WHEN public.studio_job_automatic_retry_exhausted(due_job.facts);
      PERFORM public.studio_claim_job(due_job.id, gen_random_uuid(), 900);
      claimed := claimed + 1;
    END LOOP;
  END LOOP;
  INSERT INTO public.scheduler_claim_attempts VALUES (claimed);
END
$scheduler$;
`,
    "utf8",
  );

  const attemptBeforeRetry = sql(
    `SELECT attempt_count::text FROM public.studio_upload_jobs WHERE id='${success}'`,
    true,
  );
  const scheduler = runAsync(bin("psql"), psqlArgs(["-f", schedulerPath]));
  await new Promise((resolve) => setTimeout(resolve, 900));

  // (22) The Owner-controlled claim, through the ordinary database path.
  expectEquals(
    sql(
      `SELECT count(*) FROM public.studio_request_job_processing('${success}','${TOKEN}',900)`,
      true,
    ),
    "1",
    "(22) Owner Retry claims the repaired row",
  );
  const raced = await scheduler;
  if (raced.code !== 0) {
    throw new Error(`concurrent scheduler failed\n${raced.stdout}\n${raced.stderr}`);
  }
  expectEquals(
    sql("SELECT COALESCE(sum(claimed), 0)::text FROM public.scheduler_claim_attempts", true),
    "0",
    "(23) the concurrent scheduler claimed nothing",
  );
  expectEquals(
    sql(
      `SELECT status || ':' || attempt_count FROM public.studio_upload_jobs WHERE id='${success}'`,
      true,
    ),
    `processing:${Number(attemptBeforeRetry) + 1}`,
    "(25) only the Owner-controlled attempt incremented attempt_count",
  );
  expectEquals(
    sql("SELECT count(*) FROM public.studio_upload_jobs", true),
    jobsBefore,
    "(28) controlled Retry created no new job",
  );
  expectEquals(
    sql("SELECT count(*) FROM public.projects", true),
    projectsBefore,
    "controlled Retry created no project by itself",
  );

  // ---------------------------------------------------------------------
  // Negative control: the previous template's single assignment.
  // ---------------------------------------------------------------------
  const legacy = insertFixture("legacy");
  const activeBeforeLegacy = sql(`SELECT public.studio_count_active_jobs('${ACTOR}')`, true);
  sql(`UPDATE public.studio_upload_jobs SET retryable=true WHERE id='${legacy}'`);
  expectEquals(
    sql(DUE_FOR(legacy), true),
    "1",
    "negative control: retryable alone puts the legacy row back in the due lane",
  );
  assertions += 1;
  if (sql(`SELECT public.studio_count_active_jobs('${ACTOR}')`, true) === activeBeforeLegacy) {
    throw new Error("negative control: retryable alone should have raised the active count");
  }
  sql(`DELETE FROM public.studio_upload_jobs WHERE id='${legacy}'`);

  // ---------------------------------------------------------------------
  // (27, 28, 30-42) Rollback matrix. Every guard refuses, changes nothing,
  // and writes no audit event.
  // ---------------------------------------------------------------------
  expectRepairRefused({ ...preflight(untouched), job_id: absent }, "zero-row mismatch");

  const mutated = [
    [
      "status",
      (jobId) => sql(`UPDATE public.studio_upload_jobs SET status='received' WHERE id='${jobId}'`),
    ],
    [
      "provider",
      (jobId) =>
        sql(
          `UPDATE public.studio_upload_jobs
              SET facts=jsonb_set(facts, '{storage,provider}', '"supabase"')
            WHERE id='${jobId}'`,
        ),
    ],
    [
      "attempt",
      (jobId) => sql(`UPDATE public.studio_upload_jobs SET attempt_count=8 WHERE id='${jobId}'`),
    ],
    [
      "result",
      (jobId) =>
        sql(
          `UPDATE public.studio_upload_jobs SET result_summary='{"projectSlug":"unexpected"}'::jsonb
            WHERE id='${jobId}'`,
        ),
    ],
    [
      "retryableAlready",
      (jobId) => sql(`UPDATE public.studio_upload_jobs SET retryable=true WHERE id='${jobId}'`),
    ],
    [
      "activeClaim",
      (jobId) =>
        sql(
          `UPDATE public.studio_upload_jobs
              SET processing_token='${TOKEN}', processing_started_at=now()
            WHERE id='${jobId}'`,
        ),
    ],
    [
      "errorEvidence",
      (jobId) =>
        sql(
          `UPDATE public.studio_upload_jobs SET error='A different safe message.' WHERE id='${jobId}'`,
        ),
    ],
    [
      "facts",
      (jobId) =>
        sql(
          `UPDATE public.studio_upload_jobs
              SET facts=jsonb_set(facts, '{projectFacts,name}', '"Changed"')
            WHERE id='${jobId}'`,
        ),
    ],
  ];

  for (const [label, mutate] of mutated) {
    const jobId = insertFixture(`mutated-${label}`);
    const params = preflight(jobId);
    mutate(jobId);
    expectRepairRefused(params, `changed ${label}`);
  }

  // Material guards. Each fixture's OWN digests are supplied, so only the
  // material contract can be what refuses it.
  const materialCases = [
    ["five files", MANIFESTS.five],
    ["seven files", MANIFESTS.seven],
    ["wrong project-photo count", MANIFESTS.wrongPhotoCount],
    ["missing brochure", MANIFESTS.missingBrochure],
    ["missing price list", MANIFESTS.missingPriceList],
    ["missing developer profile", MANIFESTS.missingDeveloper],
    ["payment plan present", MANIFESTS.paymentPlan],
    ["archive present", MANIFESTS.archive],
    ["unknown purpose", MANIFESTS.unknownPurpose],
    ["absent purpose", MANIFESTS.absentPurpose],
    ["non-R2 manifest entry", MANIFESTS.nonR2],
    ["wrong purpose source", MANIFESTS.wrongPurposeSource],
  ];

  for (const [label, manifest] of materialCases) {
    const jobId = insertFixture(`material-${label}`, manifest);
    const params = preflight(jobId);
    expectRepairRefused(params, `material guard: ${label}`);
    // A wrong file count must also refuse when the operator forces the count.
    if (manifest.length !== 6) {
      expectRepairRefused(params, `material guard: ${label} with forced count`, {
        expected_file_count: 6,
      });
    }
  }

  // A different workflow is outside this exceptional procedure entirely.
  const otherWorkflow = insertFixture("other-workflow", MANIFESTS.authorized, {
    workflow: "project_update",
  });
  expectRepairRefused(preflight(otherWorkflow), "workflow outside the authorized shape");

  // (26) A controlled failure refreshes the bounded automatic budget without
  // rewriting history: the closed vocabulary allows the round trip.
  const refreshed = insertFixture("refreshed");
  sql(
    `UPDATE public.studio_upload_jobs
        SET facts = facts || '{"retry":{"automaticFailures":5,"automatic":"exhausted"}}'::jsonb
      WHERE id='${refreshed}'`,
  );
  expectEquals(
    sql(
      `SELECT public.studio_job_automatic_retry_exhausted(facts)::text
         FROM public.studio_upload_jobs WHERE id='${refreshed}'`,
      true,
    ),
    "true",
    "an exhausted job is excluded before the controlled attempt",
  );
  sql(
    `UPDATE public.studio_upload_jobs
        SET facts = facts || '{"retry":{"automaticFailures":0,"automatic":"eligible"}}'::jsonb
      WHERE id='${refreshed}'`,
  );
  expectEquals(
    sql(
      `SELECT public.studio_job_automatic_retry_exhausted(facts)::text || '|' || attempt_count
         FROM public.studio_upload_jobs WHERE id='${refreshed}'`,
      true,
    ),
    "false|7",
    "(26) a controlled failure refreshes the budget and keeps attempt_count",
  );

  // A repaired row that already carries a retry streak keeps it.
  const withStreak = insertFixture("with-streak", MANIFESTS.authorized, {
    facts: { ...FACTS, retry: { automaticFailures: 5, automatic: "eligible" } },
  });
  psqlFile(TEMPLATE, preflight(withStreak));
  expectEquals(
    sql(
      `SELECT (facts #> '{retry}')::text FROM public.studio_upload_jobs WHERE id='${withStreak}'`,
      true,
    ),
    '{"automatic": "exhausted", "automaticFailures": 5}',
    "an existing automatic-failure streak is preserved, not reset",
  );

  // (40, 41) Terminal false stays unclaimable.
  expectEquals(
    sql(
      `SELECT count(*) FROM public.studio_request_job_processing('${untouched}','${TOKEN}',900)`,
      true,
    ),
    "0",
    "terminal row unavailable before repair",
  );

  // (39, 42) Repository template has no credential, production identifier,
  // generic administration hook, or Supabase Storage fallback.
  const templateText = readFileSync(TEMPLATE, "utf8");
  assertions += 1;
  if (
    /sb_secret_|service.role|eyJ[A-Za-z0-9_-]+\.|R2_SECRET|ACCESS_KEY|postgres(?:ql)?:\/\//i.test(
      templateText,
    )
  ) {
    throw new Error("repair template contains a credential-shaped value");
  }
  assertions += 1;
  if (
    /storage\.objects|supabase|make any job retryable|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i.test(
      templateText,
    )
  ) {
    throw new Error("repair template introduces a generic feature or Supabase fallback");
  }
  assertions += 1;
  if (!/:'job_id'::uuid/.test(templateText)) {
    throw new Error("repair template does not require a runtime exact job parameter");
  }

  console.log(
    `[contained-repair-pg17] PASS: ${assertions} contract assertions on disposable PostgreSQL 17`,
  );
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
