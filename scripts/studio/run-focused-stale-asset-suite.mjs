#!/usr/bin/env node
/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the focused acceptance suite, with
 * EXACT and SEPARATE totals (independent-review P2-2 and P2-6).
 *
 * The reviewed implementation report stated "8 files, 149 passed, 0 failed".
 * Measured: 143 passed, 6 SKIPPED, 149 total — and the six skipped were exactly
 * the generated-Worker-config and client-secret checks that silently did not
 * run without a build. Presenting skipped tests as passed is the specific
 * inaccuracy that concealed the gap.
 *
 * So the counts are produced by a machine, reported separately, and asserted:
 *
 *   - passed, failed, skipped/pending and not-run are each reported;
 *   - skipped is asserted to be ZERO — the focused suite must contain no
 *     unintended skips;
 *   - a run that collected zero tests is a FAILURE, not a pass;
 *   - a missing build is a FAILURE, because the suite's build-dependent
 *     contracts would otherwise not run.
 *
 * Nothing here deploys, publishes, reads a credential or touches production.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const REPORT = resolve(REPO_ROOT, ".forever-build/focused-suite.json");

/** The focused stale-asset acceptance suite, enumerated. */
export const FOCUSED_SUITE = [
  "src/lib/stale-asset/acceptance-reporting.test.ts",
  "src/lib/stale-asset/client-asset-identity.test.ts",
  "src/lib/stale-asset/global-capture.test.ts",
  "src/lib/stale-asset/release-binding-preflight.test.ts",
  "src/lib/stale-asset/release-identity-separation.test.ts",
  "src/lib/stale-asset/release-runbook-contract.test.ts",
  "src/lib/stale-asset/root-boundary.test.tsx",
  "src/lib/stale-asset/stale-asset-classifier.test.ts",
  "src/lib/stale-asset/stale-asset-recovery.test.ts",
  "src/lib/stale-asset/studio-write-contract.test.ts",
  "src/lib/stale-asset/tanstack-reload-ownership.test.ts",
  "src/lib/stale-asset/worker-binding-capture.test.ts",
  "src/lib/stale-asset/worker-config-contract.test.ts",
  "src/lib/stale-asset/worker-upload-command.test.ts",
  "src/lib/stale-asset/worker-variable-preservation.test.ts",
  "src/lib/stale-asset/write-safety.test.ts",
];

function log(message) {
  process.stdout.write(`[focused-suite] ${message}\n`);
}

const RUN_BUILD_FIRST =
  "Run `npm run build` before the focused suite. Several of its contracts assert what actually " +
  "deploys, and a missing or non-production build artifact is a FAILURE, never a skip " +
  "(independent-review P2-2).";

/**
 * Requires `.output` to be a PRODUCTION build of this working tree.
 *
 * Not merely "a build exists": the two-version browser harness also writes
 * `.output`, with a different Nitro preset and a test seam compiled in, and a
 * suite run against that would assert the wrong artefact. The production
 * orchestrator records the identity it sealed, so requiring that exact identity
 * to be present in the emitted client bundle proves which build this is.
 */
function requireProductionBuild() {
  const assets = resolve(REPO_ROOT, ".output/public/assets");
  if (!existsSync(assets)) throw new Error(`no build to inspect. ${RUN_BUILD_FIRST}`);

  const record = resolve(REPO_ROOT, ".forever-build/identity.json");
  if (!existsSync(record)) {
    throw new Error(`no output-derived identity record. ${RUN_BUILD_FIRST}`);
  }
  const { foreverClientAssetId, selfVerified } = JSON.parse(readFileSync(record, "utf8"));
  if (!selfVerified) throw new Error(`the recorded build did not self-verify. ${RUN_BUILD_FIRST}`);

  const { readdirSync } = require("node:fs");
  const present = readdirSync(assets)
    .filter((name) => name.endsWith(".js"))
    .some((name) => readFileSync(resolve(assets, name), "utf8").includes(foreverClientAssetId));
  if (!present) {
    throw new Error(
      `.output does not carry the recorded production identity ${foreverClientAssetId} — it is a ` +
        `different build (the two-version harness also writes .output). ${RUN_BUILD_FIRST}`,
    );
  }
}

function main() {
  requireProductionBuild();

  mkdirSync(dirname(REPORT), { recursive: true });
  rmSync(REPORT, { force: true });

  const vitest = resolve(
    REPO_ROOT,
    "node_modules/.bin",
    process.platform === "win32" ? "vitest.cmd" : "vitest",
  );
  const result = spawnSync(
    vitest,
    ["run", "--reporter=json", `--outputFile=${REPORT}`, ...FOCUSED_SUITE],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      shell: process.platform === "win32",
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    },
  );
  if (result.error) throw new Error(`the focused suite could not be run: ${result.error.message}`);
  if (!existsSync(REPORT)) {
    throw new Error(
      `the focused suite produced no machine-readable report\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }

  const report = JSON.parse(readFileSync(REPORT, "utf8"));
  const tests = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
  const counts = {
    files: (report.testResults ?? []).length,
    total: tests.length,
    passed: tests.filter((test) => test.status === "passed").length,
    failed: tests.filter((test) => test.status === "failed").length,
    skipped: tests.filter((test) => test.status === "pending" || test.status === "skipped").length,
    todo: tests.filter((test) => test.status === "todo").length,
    notRun: FOCUSED_SUITE.length - (report.testResults ?? []).length,
  };

  log(`files            : ${counts.files} of ${FOCUSED_SUITE.length} declared`);
  log(`passed           : ${counts.passed}`);
  log(`failed           : ${counts.failed}`);
  log(`skipped/pending  : ${counts.skipped}`);
  log(`todo             : ${counts.todo}`);
  log(`not run          : ${counts.notRun}`);
  log(`total collected  : ${counts.total}`);

  const problems = [];
  if (counts.total === 0) problems.push("the suite collected ZERO tests — that is not a pass");
  if (counts.failed > 0) problems.push(`${counts.failed} test(s) failed`);
  if (counts.skipped > 0) {
    problems.push(
      `${counts.skipped} test(s) SKIPPED — the focused acceptance suite must contain zero ` +
        "unintended skips (independent-review P2-2)",
    );
    for (const test of tests.filter((t) => t.status === "pending" || t.status === "skipped")) {
      log(`  skipped: ${test.fullName ?? test.title}`);
    }
  }
  if (counts.todo > 0) problems.push(`${counts.todo} test(s) marked todo`);
  if (counts.notRun > 0) problems.push(`${counts.notRun} declared file(s) did not run`);
  if (counts.passed !== counts.total) {
    problems.push(
      `passed (${counts.passed}) does not equal total (${counts.total}) — skipped tests must ` +
        "never be added to passed tests (independent-review P2-6)",
    );
  }

  writeFileSync(
    resolve(REPO_ROOT, ".forever-build/focused-suite-counts.json"),
    `${JSON.stringify({ ...counts, problems }, null, 2)}\n`,
    "utf8",
  );

  if (problems.length > 0) {
    for (const problem of problems) log(`FAIL: ${problem}`);
    process.exitCode = 1;
    return;
  }
  log(`PASS: ${counts.passed} passed / 0 failed / 0 skipped / 0 not run`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[focused-suite] FAILED: ${error.message}\n`);
  process.exitCode = 1;
}
