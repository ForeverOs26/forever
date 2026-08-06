#!/usr/bin/env node
/**
 * Runs the entire Vitest suite, then judges the result.
 *
 * Two suites read project source material that `.gitignore` deliberately keeps
 * out of git. They pass where that material exists and fail in every fresh
 * checkout, including CI. Nothing is excluded from the run: the whole suite
 * executes, and a failure in one of those files is tolerated *only* while its
 * required paths are provably absent. Any other failure — or a failure in one
 * of these files when the data is present — fails the gate.
 *
 * Because that tolerance is never empty in CI, two things it could otherwise
 * hide are checked explicitly: every test file on disk must appear in the
 * report (a crash halfway through must not read as a pass), and a run-level
 * unhandled error is a failure even when no test file failed with it.
 *
 * Do not fabricate or copy the missing data to make them pass.
 * Review trigger: whenever a suite is added to, or removed from, the list below.
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const posix = (path) => path.split("\\").join("/");

/** Suites whose fixtures live outside git. See docs/FOREVER_DEVELOPMENT_WORKFLOW.md §5. */
const SOURCE_DATA_SUITES = [
  {
    file: "src/features/project-detail/partner-demo-data.test.ts",
    requires: [
      "forever-data/projects/modeva/source/brochure",
      "forever-data/projects/modeva/source/price-list",
    ],
    why: "statically imports the untracked Modeva brochure and price-list assets",
  },
  {
    file: "src/import/importer-preflight.test.ts",
    requires: ["forever-data/projects/coralina/source/brochure"],
    why: "the Coralina importer preflight reads untracked source documents",
  },
];

/** A requirement is met when the directory exists and holds something besides .gitkeep. */
const dataPresent = (rel) => {
  const dir = join(ROOT, rel);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((entry) => entry !== ".gitkeep");
};

/** Mirrors the `include` glob in vitest.config.ts: src/**\/*.{test,spec}.{ts,tsx} */
const TEST_FILE = /\.(test|spec)\.tsx?$/;
const discoverTestFiles = (dir, found = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) discoverTestFiles(full, found);
    else if (TEST_FILE.test(entry)) found.push(posix(relative(ROOT, full)));
  }
  return found;
};

const reportPath = join(tmpdir(), `forever-vitest-${process.pid}.json`);
// The local binary is invoked directly — no shell, identical on every platform.
const vitest = join(ROOT, "node_modules", "vitest", "vitest.mjs");

// Piped rather than inherited so the output can be inspected for run-level
// errors, then forwarded unchanged so the run still streams live.
let transcript = "";
const status = await new Promise((settle) => {
  const child = spawn(
    process.execPath,
    [vitest, "run", "--reporter=default", "--reporter=json", `--outputFile.json=${reportPath}`],
    { cwd: ROOT, stdio: ["inherit", "pipe", "pipe"] },
  );
  const tee = (source, sink) =>
    source.on("data", (chunk) => {
      transcript += chunk.toString();
      sink.write(chunk);
    });
  tee(child.stdout, process.stdout);
  tee(child.stderr, process.stderr);
  child.on("error", (error) => {
    console.error(`test:ci FAILED — could not start vitest: ${error.message}`);
    process.exit(1);
  });
  child.on("close", settle);
});

if (!existsSync(reportPath)) {
  console.error(`\ntest:ci FAILED — vitest exited ${status} and wrote no JSON report`);
  process.exit(1);
}
const raw = readFileSync(reportPath, "utf8");
rmSync(reportPath, { force: true });

let report;
try {
  report = JSON.parse(raw);
} catch (error) {
  console.error(`\ntest:ci FAILED — unreadable vitest report: ${error.message}`);
  process.exit(1);
}

// Completeness floor: a truncated run must never read as a green one. The JSON
// report only describes the files that actually ran.
const reported = new Set(
  (report.testResults ?? []).map((result) => posix(relative(ROOT, result.name))),
);
const missing = discoverTestFiles(join(ROOT, "src")).filter((file) => !reported.has(file));
if (missing.length > 0) {
  console.error(
    `\ntest:ci FAILED — ${missing.length} test file(s) on disk never reported a result:`,
  );
  missing.slice(0, 20).forEach((file) => console.error(`  - ${file}`));
  if (missing.length > 20) console.error(`  … and ${missing.length - 20} more`);
  console.error("  The run did not complete. A partial suite is never a pass.");
  process.exit(1);
}

// The JSON reporter drops vitest's run-level errors, so they are read from the
// transcript. An unhandled rejection is a failure, never a skip.
if (/Unhandled (Error|Rejection)/.test(transcript)) {
  console.error("\ntest:ci FAILED — vitest reported an unhandled run-level error (see above).");
  process.exit(1);
}

if (status === 0) {
  console.log("\ntest:ci PASSED — full Vitest suite green");
  process.exit(0);
}

const failedFiles = (report.testResults ?? [])
  .filter((result) => result.status === "failed")
  .map((result) => posix(relative(ROOT, result.name)));

if (failedFiles.length === 0) {
  console.error(`\ntest:ci FAILED — vitest exited ${status} with no failing test file.`);
  process.exit(1);
}

const tolerated = [];
const unexpected = [];

for (const file of failedFiles) {
  const declared = SOURCE_DATA_SUITES.find((suite) => suite.file === file);
  const absent = declared?.requires.filter((path) => !dataPresent(path)) ?? [];
  if (declared && absent.length > 0) tolerated.push({ file, why: declared.why, absent });
  else unexpected.push(file);
}

console.error("");
for (const entry of tolerated) {
  console.error(`test:ci TOLERATED  ${entry.file}`);
  console.error(`  ${entry.why}`);
  console.error(`  absent in this checkout: ${entry.absent.join(", ")}`);
}

if (unexpected.length > 0) {
  console.error(`\ntest:ci FAILED — ${unexpected.length} unexpected failing test file(s):`);
  unexpected.forEach((file) => console.error(`  - ${file}`));
  console.error("\nSee the vitest output above. Contract: docs/FOREVER_DEVELOPMENT_WORKFLOW.md");
  process.exit(1);
}

console.log(
  `\ntest:ci PASSED — ${report.numPassedTests ?? "?"} tests passed; ` +
    `${tolerated.length} declared source-data suite(s) tolerated because their fixtures are not in git.\n` +
    "  Tolerance is per FILE: a new test added to one of them is not gated in a fresh checkout.",
);
