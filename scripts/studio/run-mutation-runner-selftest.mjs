#!/usr/bin/env node
/**
 * Self-test for the mutation harness itself.
 *
 * The mutation runner is evidence about the test suite, so it needs its own
 * evidence. This runs REPRESENTATIVE mutations — a single-line one and a
 * multi-line one — against two byte-level fixtures of the same source: one LF,
 * one CRLF. For each it proves the runner
 *
 *   - locates the intended target under either line ending,
 *   - fails the fixture's NAMED assertion (a real child process, really run),
 *   - restores the file to its original SHA-256 exactly.
 *
 * It also proves the two ways a runner can lie are rejected: a spawn failure is
 * never counted as a detection, and a mutation whose tests still pass is
 * reported as survived rather than caught.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { classifyRun, replaceExactlyOnce, restoreAll, sha256 } from "./mutation-runner-core.mjs";

const work = mkdtempSync(join(tmpdir(), "forever-mutation-selftest-"));
let checks = 0;
let failed = false;

function assert(condition, label) {
  checks += 1;
  if (!condition) throw new Error(`self-test failed: ${label}`);
}

/**
 * The fixture under mutation. Deliberately shaped like the real target: a
 * single-line guard and a multi-line block whose literal spans a newline.
 */
const FIXTURE_SOURCE = [
  "export const DEADLINE_MS = 840000;",
  "",
  "export function startAction(clock) {",
  "  if (clock.locked) return null;",
  "  const timers = {",
  "    deadline: clock.setTimeout(clock.expire, DEADLINE_MS),",
  "    polls: 0,",
  "  };",
  "  return timers;",
  "}",
  "",
].join("\n");

/**
 * A checker that behaves like the real suite: it prints a vitest-shaped summary
 * line and a NAMED assertion, so `classifyRun` is exercised exactly as it is in
 * production rather than through a special case.
 */
const CHECKER_SOURCE = [
  "import { readFileSync } from 'node:fs';",
  "const source = readFileSync(process.argv[2], 'utf8');",
  "const failures = [];",
  "if (!/if \\(clock\\.locked\\) return null;/.test(source)) {",
  "  failures.push('the action keeps its synchronous lock');",
  "}",
  "if (!/deadline: clock\\.setTimeout\\(clock\\.expire, DEADLINE_MS\\)/.test(source)) {",
  "  failures.push('the action arms one absolute deadline');",
  "}",
  "for (const failure of failures) console.log('FAIL: ' + failure);",
  "console.log(`Tests  ${failures.length} failed | ${2 - failures.length} passed (2)`);",
  "process.exitCode = failures.length === 0 ? 0 : 1;",
  "",
].join("\n");

const MUTATIONS = [
  {
    name: "single-line lock removed",
    from: "  if (clock.locked) return null;",
    to: "  if (false) return null;",
    reason: /the action keeps its synchronous lock/,
  },
  {
    name: "multi-line deadline removed",
    from: "  const timers = {\n    deadline: clock.setTimeout(clock.expire, DEADLINE_MS),\n    polls: 0,\n  };",
    to: "  const timers = {\n    deadline: null,\n    polls: 0,\n  };",
    reason: /the action arms one absolute deadline/,
  },
];

const checker = join(work, "checker.mjs");
writeFileSync(checker, CHECKER_SOURCE, "utf8");

function runChecker(file) {
  return spawnSync(process.execPath, [checker, file], {
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
}

try {
  for (const [mode, eol] of [
    ["lf", "\n"],
    ["crlf", "\r\n"],
  ]) {
    const file = join(work, `fixture-${mode}.mjs`);
    writeFileSync(file, FIXTURE_SOURCE.replace(/\n/g, eol), "utf8");
    const original = readFileSync(file);
    const originalDigest = sha256(original);

    // The fixture really is the line ending it claims to be.
    assert(
      mode === "crlf" ? original.includes("\r\n") : !original.includes("\r"),
      `${mode} fixture uses ${mode.toUpperCase()} line endings`,
    );

    // The unmutated baseline must pass, or nothing after it means anything.
    const baseline = classifyRun(runChecker(file), /never matches/);
    assert(baseline.verdict === "survived", `${mode} baseline passes before any mutation`);

    for (const mutation of MUTATIONS) {
      try {
        const applied = replaceExactlyOnce(file, mutation.from, mutation.to);
        assert(applied.length > 0, `${mode}: ${mutation.name} located its target`);
        assert(
          applied.usesCrlf === (mode === "crlf"),
          `${mode}: ${mutation.name} matched the fixture's own line ending`,
        );
        // A mutated file keeps one newline convention.
        const mutated = readFileSync(file);
        assert(
          mode === "crlf" ? !/[^\r]\n/.test(mutated.toString("utf8")) : !mutated.includes("\r"),
          `${mode}: ${mutation.name} did not introduce a second newline convention`,
        );

        const verdict = classifyRun(runChecker(file), mutation.reason);
        assert(
          verdict.verdict === "detected",
          `${mode}: ${mutation.name} failed its named assertion (${verdict.verdict} ${verdict.detail})`,
        );
      } finally {
        writeFileSync(file, original);
      }

      assert(
        sha256(readFileSync(file)) === originalDigest,
        `${mode}: ${mutation.name} restored the fixture byte-for-byte`,
      );
    }

    // A mutation the checker cannot see is reported as survived, not detected.
    try {
      replaceExactlyOnce(file, "  polls: 0,", "  polls: 1,");
      const verdict = classifyRun(runChecker(file), /the action arms one absolute deadline/);
      assert(verdict.verdict === "survived", `${mode}: an undetected mutation reports as survived`);
    } finally {
      writeFileSync(file, original);
    }

    // A process that cannot start is a runner failure, never evidence.
    const missing = spawnSync(join(work, "definitely-not-a-real-binary"), [], { encoding: "utf8" });
    const spawnVerdict = classifyRun(missing, /the action arms one absolute deadline/);
    assert(
      spawnVerdict.verdict === "runner_failure",
      `${mode}: a spawn failure is rejected as invalid evidence`,
    );

    // So is a nonzero exit with no reported test failure.
    const noTests = spawnSync(process.execPath, ["-e", "process.exitCode = 1"], {
      encoding: "utf8",
    });
    assert(
      classifyRun(noTests, /the action arms one absolute deadline/).verdict === "runner_failure",
      `${mode}: a nonzero exit that ran no test is rejected as invalid evidence`,
    );

    const mismatched = restoreAll(new Map([[file, original]]));
    assert(mismatched.length === 0, `${mode}: restoreAll proves byte-for-byte restoration`);
    assert(sha256(readFileSync(file)) === originalDigest, `${mode}: final digest is the original`);
  }

  console.log(`[mutation-selftest] PASS: ${checks} checks across LF and CRLF fixtures`);
} catch (error) {
  failed = true;
  console.error(`[mutation-selftest] FAIL\n${error.message}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failed) process.exitCode = 1;
