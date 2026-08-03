#!/usr/bin/env node
/**
 * Mutation controls for the PR #134 retry, repair-isolation and material-guard
 * fixes.
 *
 * Every mutation is applied to one working-tree file, must make a NAMED test
 * fail, and is restored from the original Buffer in a finally block. A final
 * byte comparison proves the source tree is exactly as it started.
 *
 * The matching, classification and restoration primitives live in
 * `mutation-runner-core.mjs` and are covered by
 * `run-mutation-runner-selftest.mjs` against both LF and CRLF fixtures — this
 * runner works in a Windows `core.autocrlf=true` checkout and a Unix LF
 * checkout without a separate wrapper, and never counts a process that failed
 * to start as a detection.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MutationRunnerError,
  classifyRun,
  replaceExactlyOnce,
  restoreAll,
} from "./mutation-runner-core.mjs";

const REPO = process.cwd();
const DASHBOARD = resolve(REPO, "src/features/forever-studio/components/StudioDashboard.tsx");
const TIMING = resolve(REPO, "src/features/forever-studio/components/manual-retry-observation.ts");
const TEMPLATE = resolve(REPO, "docs/FOREVER_STUDIO_CONTAINED_R2_JOB_EXACT_ROW_REPAIR.sql");
const MIGRATION = resolve(
  REPO,
  "supabase/migrations/20260803090000_studio_automatic_retry_eligibility.sql",
);
const UI_TEST = "src/features/forever-studio/tests/manual-retry-progress.test.tsx";
const SOURCE_TEST = "src/features/forever-studio/tests/manual-retry-source-contract.test.ts";
const SQL_TEST = "src/features/forever-studio/tests/contained-job-repair-template.test.ts";
const MIGRATION_TEST = "src/features/forever-studio/tests/migration-contract.test.ts";
const VITEST = resolve(
  REPO,
  "node_modules/.bin",
  process.platform === "win32" ? "vitest.cmd" : "vitest",
);

const originals = new Map(
  [DASHBOARD, TIMING, TEMPLATE, MIGRATION].map((file) => [file, readFileSync(file)]),
);
const templateSource = originals.get(TEMPLATE).toString("utf8");

/** The guarded UPDATE's whole WHERE clause, taken from the file as it is. */
const guardedUpdateWhere = templateSource.slice(
  templateSource.indexOf("     WHERE job.id = expected_params.job_id"),
  templateSource.indexOf("    RETURNING job.* INTO after_row"),
);
if (!guardedUpdateWhere) {
  throw new MutationRunnerError("could not locate the guarded UPDATE WHERE clause in the template");
}

function test(files) {
  return spawnSync(VITEST, ["run", ...files], {
    cwd: REPO,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
}

const mutations = [
  // -- PART 3: the absolute manual-Retry deadline ---------------------------
  {
    name: "deadline starts after the mutation response",
    file: DASHBOARD,
    from: `      deadlineTimer: setTimeout(
        () => expireOwnerRetry(job.id),
        STUDIO_OWNER_RETRY_OBSERVATION.totalTimeoutMs,
      ),
      nextIntervalMs: STUDIO_OWNER_RETRY_OBSERVATION.initialIntervalMs,
      expired: false,
      abort: typeof AbortController === "function" ? new AbortController() : null,
    };
    retryTimersRef.current.set(job.id, timers);

    try {
      const result = await retryJob.mutateAsync({ jobId: job.id, signal: timers.abort?.signal });`,
    to: `      deadlineTimer: 0 as unknown as ReturnType<typeof setTimeout>,
      nextIntervalMs: STUDIO_OWNER_RETRY_OBSERVATION.initialIntervalMs,
      expired: false,
      abort: typeof AbortController === "function" ? new AbortController() : null,
    };

    try {
      const result = await retryJob.mutateAsync({ jobId: job.id, signal: timers.abort?.signal });
      timers.deadlineTimer = setTimeout(
        () => expireOwnerRetry(job.id),
        STUDIO_OWNER_RETRY_OBSERVATION.totalTimeoutMs,
      );
      retryTimersRef.current.set(job.id, timers);`,
    tests: [UI_TEST, SOURCE_TEST],
    reason: /a mutation that never settles ends in a bounded truthful state/,
  },
  {
    name: "submit watchdog removed",
    file: DASHBOARD,
    from: "        () => expireOwnerRetry(job.id),\n        STUDIO_OWNER_RETRY_OBSERVATION.totalTimeoutMs,",
    to: "        () => undefined,\n        STUDIO_OWNER_RETRY_OBSERVATION.totalTimeoutMs,",
    tests: [UI_TEST],
    reason: /a mutation that never settles ends in a bounded truthful state/,
  },
  {
    name: "late response reactivates polling",
    file: DASHBOARD,
    from: "      if (retryTimersRef.current.get(job.id) !== timers || timers.expired) return;\n      if (!settleOwnerRetry(result)) observeOwnerRetry(job.id, result, timers);",
    to: "      if (!settleOwnerRetry(result)) observeOwnerRetry(job.id, result, timers);",
    tests: [UI_TEST],
    reason: /a mutation resolving after the deadline is ignored as stale/,
  },
  {
    name: "timeout unlocks Retry",
    file: DASHBOARD,
    from: `                  ? ownerRetryIsBusy(ownerRetry) ||
                    (ownerRetry.phase === "failed" && ownerRetry.retryable)`,
    to: `                  ? ownerRetryIsBusy(ownerRetry) ||
                    ownerRetry.phase === "timeout" ||
                    (ownerRetry.phase === "failed" && ownerRetry.retryable)`,
    tests: [UI_TEST],
    reason: /the deadline never marks the job failed, resubmits, or unlocks Retry/,
  },
  {
    name: "timeout releases the per-job Retry lock",
    file: DASHBOARD,
    from: "    // Deliberately retain the per-job lock. Only a read-only Refresh that\n    // observes a retryable failure may make another Retry available.",
    to: "    retryLocksRef.current.delete(jobId);",
    tests: [SOURCE_TEST],
    reason: /timeout is read-only and never submits another controlled Retry/,
  },
  {
    name: "polling receives a fresh full deadline",
    file: DASHBOARD,
    from: `    // No new deadline. The one armed before the mutation is still running, so
    // observation receives only the remaining budget.
    const schedule = () => {`,
    to: `    clearTimeout(timers.deadlineTimer);
    timers.deadlineTimer = setTimeout(
      () => expireOwnerRetry(jobId),
      STUDIO_OWNER_RETRY_OBSERVATION.totalTimeoutMs,
    );
    const schedule = () => {`,
    tests: [SOURCE_TEST],
    reason: /observation inherits the action's timers instead of creating new ones/,
  },
  {
    name: "expiry stops cancelling the pending request",
    file: DASHBOARD,
    from: "      timers.expired = true;\n      timers.abort?.abort();",
    to: "      timers.expired = true;",
    tests: [SOURCE_TEST],
    reason: /expiry cancels locally and never treats cancellation as a server outcome/,
  },
  {
    name: "timeout claims the job failed",
    file: DASHBOARD,
    from: '      phase: "timeout",\n      status: prior?.status ?? "processing",',
    to: '      phase: "timeout",\n      status: "failed",',
    tests: [UI_TEST],
    reason: /the deadline never marks the job failed, resubmits, or unlocks Retry/,
  },

  // -- PART 1: atomic Owner-only repair isolation ---------------------------
  {
    name: "repair omits automatic=exhausted",
    file: TEMPLATE,
    from: `       SET retryable = true,
           facts = job.facts
             || jsonb_build_object(
                  'retry',
                  COALESCE(job.facts -> 'retry', '{}'::jsonb)
                    || jsonb_build_object('automatic', expected.required_automatic_state)
                )`,
    to: "       SET retryable = true",
    tests: [SQL_TEST],
    reason: /writes retryability and automatic exhaustion atomically/,
  },
  {
    name: "retryable is committed by a separate write from the exhaustion state",
    file: TEMPLATE,
    from: "    RETURNING job.* INTO after_row;\n    GET DIAGNOSTICS update_rows = ROW_COUNT;",
    to: `    RETURNING job.* INTO after_row;
    GET DIAGNOSTICS update_rows = ROW_COUNT;
    UPDATE public.studio_upload_jobs AS job
       SET facts = job.facts || '{"retry":{"automatic":"exhausted"}}'::jsonb
     WHERE job.id = p.job_id;`,
    tests: [SQL_TEST],
    reason: /writes retryability and automatic exhaustion atomically/,
  },
  {
    name: "retry state written with jsonb_set, which silently no-ops on legacy rows",
    file: TEMPLATE,
    from: `           facts = job.facts
             || jsonb_build_object(
                  'retry',
                  COALESCE(job.facts -> 'retry', '{}'::jsonb)
                    || jsonb_build_object('automatic', expected.required_automatic_state)
                )`,
    to: `           facts = jsonb_set(job.facts, '{retry,automatic}', '"exhausted"'::jsonb, true)`,
    tests: [SQL_TEST],
    reason: /builds the retry state without depending on an existing retry key/,
  },
  {
    name: "post-repair due-jobs assertion removed",
    file: TEMPLATE,
    from: `      SELECT count(*)
        INTO due_after
        FROM public.studio_list_due_jobs(now(), 100, before_row.created_by) AS due
       WHERE due.id = p.job_id;`,
    to: "      due_after := 0;",
    tests: [SQL_TEST],
    reason: /proves due and active exclusion inside the repair transaction/,
  },
  {
    name: "post-repair active-count assertion removed",
    file: TEMPLATE,
    from: "      active_after := public.studio_count_active_jobs(before_row.created_by);",
    to: "      active_after := active_before;",
    tests: [SQL_TEST],
    reason: /proves due and active exclusion inside the repair transaction/,
  },

  // -- PART 2: the exact six-file material guard ----------------------------
  {
    name: "exact file-count guard removed",
    file: TEMPLATE,
    from: "  expected_file_count integer NOT NULL CHECK (expected_file_count = 6),",
    to: "  expected_file_count integer NOT NULL CHECK (expected_file_count > 0),",
    tests: [SQL_TEST],
    reason: /requires the exact authorized six-file material multiset/,
  },
  {
    name: "material-purpose multiset guard removed",
    file: TEMPLATE,
    from: `  '{"project_photo": 3, "brochure": 1, "price_list": 1, "developer_profile": 1}'::jsonb,`,
    to: `  '{}'::jsonb,`,
    tests: [SQL_TEST],
    reason: /requires the exact authorized six-file material multiset/,
  },
  {
    name: "purpose-source guard removed",
    file: TEMPLATE,
    from: `            AND file_entry->>'purposeSource' IS DISTINCT FROM expected.required_purpose_source
       )`,
    to: `            AND false
       )`,
    tests: [SQL_TEST],
    reason: /requires the exact authorized six-file material multiset/,
  },
  {
    name: "repair UPDATE guarded only by id",
    file: TEMPLATE,
    from: guardedUpdateWhere,
    to: "     WHERE job.id = expected_params.job_id\n",
    tests: [SQL_TEST],
    reason: /locks one exact row and repeats every invariant/,
  },
  {
    name: "exactly-one-row assertion removed",
    file: TEMPLATE,
    from: "IF update_rows IS DISTINCT FROM 1 THEN",
    to: "IF false THEN",
    tests: [SQL_TEST],
    reason: /locks one exact row and repeats every invariant/,
  },
  {
    name: "attempt_count UPDATE guard removed",
    file: TEMPLATE,
    from: "       AND job.attempt_count = expected_params.expected_attempt_count\n",
    to: "",
    tests: [SQL_TEST],
    reason: /locks one exact row and repeats every invariant/,
  },
  {
    name: "project-result UPDATE guard removed",
    file: TEMPLATE,
    from: "       AND job.result_summary IS NULL\n",
    to: "",
    tests: [SQL_TEST],
    reason: /locks one exact row and repeats every invariant/,
  },
  {
    name: "mismatch commits instead of rolling back",
    file: TEMPLATE,
    from: "  ROLLBACK;\n  \\echo 'contained_job_repair_rolled_back",
    to: "  COMMIT;\n  \\echo 'contained_job_repair_rolled_back",
    tests: [SQL_TEST],
    reason: /rolls back every mismatch/,
  },
  {
    name: "repair template hard-codes a job identifier",
    file: TEMPLATE,
    from: ":'job_id'::uuid,",
    to: "'11111111-1111-4111-8111-111111111111'::uuid,",
    tests: [SQL_TEST],
    reason: /requires runtime parameters and contains no credential or fixed job id/,
  },

  // -- The automatic lane itself -------------------------------------------
  {
    name: "due query accepts an exhausted row",
    file: MIGRATION,
    from: `  WHERE (p_created_by IS NULL OR job.created_by = p_created_by)
    AND job.processing_requested_at IS NOT NULL
    AND NOT public.studio_job_automatic_retry_exhausted(job.facts)
    AND (
      job.status = 'received'`,
    to: `  WHERE (p_created_by IS NULL OR job.created_by = p_created_by)
    AND job.processing_requested_at IS NOT NULL
    AND (
      job.status = 'received'`,
    tests: [MIGRATION_TEST],
    reason: /excludes automatically exhausted jobs BEFORE ordering, limiting and counting/,
  },
  {
    name: "active count accepts an exhausted row",
    file: MIGRATION,
    from: `  WHERE (p_created_by IS NULL OR job.created_by = p_created_by)
    AND job.processing_requested_at IS NOT NULL
    AND NOT public.studio_job_automatic_retry_exhausted(job.facts)
    AND (
      job.status IN ('received', 'processing')`,
    to: `  WHERE (p_created_by IS NULL OR job.created_by = p_created_by)
    AND job.processing_requested_at IS NOT NULL
    AND (
      job.status IN ('received', 'processing')`,
    tests: [MIGRATION_TEST],
    reason: /excludes automatically exhausted jobs BEFORE ordering, limiting and counting/,
  },
  {
    name: "exhausted predicate treats an absent state as exhausted",
    file: MIGRATION,
    from: "  SELECT COALESCE(p_facts -> 'retry' ->> 'automatic', 'eligible') = 'exhausted';",
    to: "  SELECT COALESCE(p_facts -> 'retry' ->> 'automatic', 'exhausted') = 'exhausted';",
    tests: [MIGRATION_TEST],
    reason: /reads a closed state and never re-derives the application's threshold/,
  },

  // -- Previously covered manual-Retry contracts ----------------------------
  {
    name: "action-specific polling removed",
    file: DASHBOARD,
    from: "if (!settleOwnerRetry(result)) observeOwnerRetry(job.id, result, timers);",
    to: "if (!settleOwnerRetry(result)) markOwnerRetryTimeout(job.id);",
    tests: [UI_TEST],
    reason: /\(3, 13\) processing then published/,
  },
  {
    name: "polling incorrectly tied to activeJobs",
    file: DASHBOARD,
    from: `  const observeOwnerRetry = (jobId: string, initial: StudioJobResult, timers: OwnerRetryTimers) => {
    putOwnerRetry(jobId, {`,
    to: `  const observeOwnerRetry = (jobId: string, initial: StudioJobResult, timers: OwnerRetryTimers) => {
    if (activeJobs <= 0) return;
    putOwnerRetry(jobId, {`,
    tests: [SOURCE_TEST],
    reason: /action polling calls only the exact-job read endpoint/,
  },
  {
    name: "polling never settles published",
    file: DASHBOARD,
    from: "if (settleOwnerRetry(result)) return;",
    to: 'if (settleOwnerRetry(result) && result.status !== "published") return;',
    tests: [UI_TEST],
    reason: /\(3, 13\) processing then published/,
  },
  {
    name: "polling never settles failed",
    file: DASHBOARD,
    from: "if (settleOwnerRetry(result)) return;",
    to: 'if (settleOwnerRetry(result) && result.status !== "failed") return;',
    tests: [UI_TEST],
    reason: /\(4, 14\) processing then failed/,
  },
  {
    name: "timeout submits a second Retry",
    file: DASHBOARD,
    from: "    markOwnerRetryTimeout(jobId);\n  };",
    to: "    void retryJob.mutateAsync({ jobId });\n    markOwnerRetryTimeout(jobId);\n  };",
    tests: [UI_TEST],
    reason: /the deadline never marks the job failed, resubmits, or unlocks Retry/,
  },
  {
    name: "Retry remains enabled while pending",
    file: DASHBOARD,
    from: "disabled={ownerRetryIsBusy(ownerRetry)}",
    to: "disabled={false}",
    tests: [UI_TEST],
    reason: /\(10, 11\) disables immediately/,
  },
  {
    name: "synchronous double-click mutex removed",
    file: DASHBOARD,
    from: "if (retryLocksRef.current.has(job.id)) return;",
    to: "if (false && retryLocksRef.current.has(job.id)) return;",
    tests: [SOURCE_TEST],
    reason: /double-click has a synchronous per-job mutex/,
  },
  {
    name: "raw error text rendered",
    file: DASHBOARD,
    from: '"The retry finished safely but did not publish. Review the code below before retrying.",',
    to: 'result.error ?? "The retry finished safely but did not publish.",',
    tests: [UI_TEST],
    reason: /\(20, 21\) renders allowlisted fields/,
  },
];

let failed = false;
let detected = 0;

try {
  // The harness itself is validated before it is used as evidence.
  const selfTest = spawnSync(
    process.execPath,
    [resolve(REPO, "scripts/studio/run-mutation-runner-selftest.mjs")],
    { cwd: REPO, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } },
  );
  process.stdout.write(selfTest.stdout ?? "");
  if (selfTest.status !== 0) {
    throw new MutationRunnerError(
      `mutation-runner self-test failed\n${selfTest.stdout}\n${selfTest.stderr}`,
    );
  }

  // The unmutated baseline must pass, or no later result means anything.
  const baseline = test([UI_TEST, SOURCE_TEST, SQL_TEST, MIGRATION_TEST]);
  if (baseline.error || typeof baseline.status !== "number") {
    throw new MutationRunnerError(
      `mutation baseline could not be run: ${baseline.error?.message ?? "no exit status"}`,
    );
  }
  if (baseline.status !== 0) {
    throw new MutationRunnerError(
      `mutation baseline failed\n${baseline.stdout}\n${baseline.stderr}`,
    );
  }

  for (const mutation of mutations) {
    try {
      replaceExactlyOnce(mutation.file, mutation.from, mutation.to);
      const verdict = classifyRun(test(mutation.tests), mutation.reason);
      if (verdict.verdict !== "detected") {
        throw new MutationRunnerError(`${mutation.name}: ${verdict.verdict} — ${verdict.detail}`);
      }
      detected += 1;
      console.log(`[manual-retry-mutation] DETECTED: ${mutation.name}`);
    } finally {
      writeFileSync(mutation.file, originals.get(mutation.file));
    }
  }
} catch (error) {
  failed = true;
  console.error(`[manual-retry-mutation] FAIL\n${error.message}`);
} finally {
  const mismatched = restoreAll(originals);
  for (const file of mismatched) {
    failed = true;
    console.error(`[manual-retry-mutation] restore mismatch: ${file}`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(
    `[manual-retry-mutation] PASS: ${detected}/${mutations.length} detected; source restored byte-for-byte`,
  );
}
