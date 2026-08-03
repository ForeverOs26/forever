#!/usr/bin/env node
/**
 * Focused mutation controls for the two final PR #134 P2 fixes.
 *
 * Every mutation is applied to one working-tree file, must make a named test
 * fail, and is restored from the original Buffer in a finally block. A final
 * byte comparison proves the source tree is exactly as it started.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = process.cwd();
const DASHBOARD = resolve(REPO, "src/features/forever-studio/components/StudioDashboard.tsx");
const TIMING = resolve(REPO, "src/features/forever-studio/components/manual-retry-observation.ts");
const TEMPLATE = resolve(REPO, "docs/FOREVER_STUDIO_CONTAINED_R2_JOB_EXACT_ROW_REPAIR.sql");
const UI_TEST = "src/features/forever-studio/tests/manual-retry-progress.test.tsx";
const SOURCE_TEST = "src/features/forever-studio/tests/manual-retry-source-contract.test.ts";
const SQL_TEST = "src/features/forever-studio/tests/contained-job-repair-template.test.ts";
const VITEST = resolve(
  REPO,
  "node_modules/.bin",
  process.platform === "win32" ? "vitest.cmd" : "vitest",
);

const originals = new Map([DASHBOARD, TIMING, TEMPLATE].map((file) => [file, readFileSync(file)]));
const templateSource = originals.get(TEMPLATE).toString("utf8");
const guardedUpdateWhere = templateSource.slice(
  templateSource.indexOf("     WHERE job.id = expected.job_id"),
  templateSource.indexOf("    RETURNING job.* INTO after_row"),
);

function test(files) {
  return spawnSync(VITEST, ["run", ...files], {
    cwd: REPO,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
}

function replaceExactlyOnce(file, from, to) {
  const source = readFileSync(file, "utf8");
  const occurrences = source.split(from).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `mutation source mismatch in ${file}: expected 1 occurrence, found ${occurrences}`,
    );
  }
  writeFileSync(file, source.replace(from, to), "utf8");
}

const mutations = [
  {
    name: "action-specific polling removed",
    file: DASHBOARD,
    from: "if (!settleOwnerRetry(result)) observeOwnerRetry(job.id, result);",
    to: "if (!settleOwnerRetry(result)) markOwnerRetryTimeout(job.id);",
    tests: [UI_TEST],
    reason: /\(3, 13\) processing then published/,
  },
  {
    name: "polling incorrectly tied to activeJobs",
    file: DASHBOARD,
    from: "const observeOwnerRetry = (jobId: string, initial: StudioJobResult) => {\n    clearOwnerRetryTimers(jobId);",
    to: "const observeOwnerRetry = (jobId: string, initial: StudioJobResult) => {\n    if (activeJobs <= 0) return;\n    clearOwnerRetryTimers(jobId);",
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
    name: "observation timeout removed",
    file: DASHBOARD,
    from: "() => markOwnerRetryTimeout(jobId),",
    to: "() => undefined,",
    tests: [UI_TEST],
    reason: /\(15, 16, 17\) timeout stops observing/,
  },
  {
    name: "timeout submits a second Retry",
    file: DASHBOARD,
    from: "() => markOwnerRetryTimeout(jobId),",
    to: "() => { void retryJob.mutateAsync({ jobId }); markOwnerRetryTimeout(jobId); },",
    tests: [UI_TEST],
    reason: /\(15, 16, 17\) timeout stops observing/,
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
  {
    name: "repair UPDATE guarded only by id",
    file: TEMPLATE,
    from: guardedUpdateWhere,
    to: "     WHERE job.id = expected.job_id\n",
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
    from: "       AND job.attempt_count = expected.expected_attempt_count\n",
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
];

let failed = false;

try {
  const baseline = test([UI_TEST, SOURCE_TEST, SQL_TEST]);
  if (baseline.status !== 0) {
    throw new Error(`mutation baseline failed\n${baseline.stdout}\n${baseline.stderr}`);
  }

  for (const mutation of mutations) {
    try {
      replaceExactlyOnce(mutation.file, mutation.from, mutation.to);
      const result = test(mutation.tests);
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      if (result.status === 0) {
        throw new Error(`${mutation.name}: mutation survived its tests`);
      }
      if (!mutation.reason.test(output)) {
        throw new Error(`${mutation.name}: failed without named assertion reason\n${output}`);
      }
      console.log(`[manual-retry-mutation] DETECTED: ${mutation.name}`);
    } finally {
      writeFileSync(mutation.file, originals.get(mutation.file));
    }
  }
} catch (error) {
  failed = true;
  console.error(`[manual-retry-mutation] FAIL\n${error.message}`);
} finally {
  for (const [file, original] of originals) writeFileSync(file, original);
  for (const [file, original] of originals) {
    if (!readFileSync(file).equals(original)) {
      failed = true;
      console.error(`[manual-retry-mutation] restore mismatch: ${file}`);
    }
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(
    `[manual-retry-mutation] PASS: ${mutations.length}/${mutations.length} detected; source restored byte-for-byte`,
  );
}
