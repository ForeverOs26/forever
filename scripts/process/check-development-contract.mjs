#!/usr/bin/env node
/**
 * Forever development-contract checker.
 *
 * Deterministic, read-only, and deliberately small. It proves that the process
 * files exist, stay short, wire together, and never hand an agent a
 * copy-pasteable command that would merge, force-push, deploy or use a
 * credential. It does not lint prose and it is not a test framework.
 *
 * Contract: docs/FOREVER_DEVELOPMENT_WORKFLOW.md
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const lines = (text) => text.replace(/\n$/, "").split("\n").length;

/** Instruction files, with the line ceiling each one is allowed to reach. */
const SIZE_LIMITS = {
  "AGENTS.md": 160,
  "CLAUDE.md": 30,
  "docs/FOREVER_DEVELOPMENT_WORKFLOW.md": 250,
  "docs/FOREVER_TASK_TEMPLATE.md": 90,
  ".github/pull_request_template.md": 70,
};

const REQUIRED_FILES = [
  ...Object.keys(SIZE_LIMITS),
  ".github/workflows/quality-gate.yml",
  "scripts/process/check-development-contract.mjs",
  "scripts/process/run-full-tests.mjs",
  "scripts/process/lint-changed.mjs",
];

/**
 * Everything the forbidden-command scan reads: the instruction files, and the
 * three scripts that actually execute inside CI — where a deploy or a
 * credential read would matter most. This checker scans itself too.
 */
const SCANNED_FILES = [...REQUIRED_FILES];

const WORKFLOW = ".github/workflows/quality-gate.yml";
const CANONICAL_CI = "npm run verify:ci";
/** Every stage `verify:ci` must run, in the order it must run them. */
const CI_STAGES = ["process:check", "typecheck", "build", "test:ci", "lint:changed"];
const REQUIRED_SCRIPTS = ["process:check", "typecheck", "test:ci", "lint:changed", "verify:ci"];
const DECISION_STATES = ["APPROVED", "CORRECT ONCE", "BLOCKED", "SPLIT"];

/**
 * Commands that would authorize a merge, a history rewrite, a production
 * deployment or credential use. Patterns are assembled from fragments so this
 * checker can scan itself without matching its own source.
 */
const FORBIDDEN = [
  ["gh" + "\\s+pr\\s+merge", "authorizes merging a pull request"],
  ["--auto-?" + "merge|enablePullRequestAuto" + "Merge", "authorizes automatic merge"],
  ["git" + "\\s+push\\s+(--force|-f)\\b", "authorizes a force push"],
  ["--" + "force-with-lease", "authorizes a force push"],
  ["wrangler" + "\\s+(deploy|versions\\s+deploy|secret)", "authorizes a production deployment"],
  ["supabase" + "\\s+(db\\s+push|link)\\b", "authorizes a production database mutation"],
  ["\\$\\{\\{\\s*" + "secrets\\.", "injects a repository secret"],
  [
    "(CLOUDFLARE_API" + "_TOKEN|SUPABASE_SERVICE_ROLE" + "_KEY|R2_SECRET_ACCESS" + "_KEY)",
    "uses a credential",
  ],
];

const failures = [];
const fail = (message) => failures.push(message);

// 1. Required process files exist.
const missing = REQUIRED_FILES.filter((file) => !existsSync(join(ROOT, file)));
missing.forEach((file) => fail(`missing required process file: ${file}`));

// 2. CLAUDE.md imports AGENTS.md (Claude Code reads CLAUDE.md, not AGENTS.md).
if (!missing.includes("CLAUDE.md")) {
  if (!/^@AGENTS\.md\s*$/m.test(read("CLAUDE.md"))) {
    fail("CLAUDE.md must import the shared contract with a line containing exactly `@AGENTS.md`");
  }
}

// 3. Instruction files stay under their agreed size limits.
for (const [file, limit] of Object.entries(SIZE_LIMITS)) {
  if (missing.includes(file)) continue;
  const count = lines(read(file));
  if (count > limit) fail(`${file} is ${count} lines; the limit is ${limit}`);
}

// 4. The PR template carries every reviewer decision state.
if (!missing.includes(".github/pull_request_template.md")) {
  const template = read(".github/pull_request_template.md");
  for (const state of DECISION_STATES) {
    if (!template.includes(state))
      fail(`pull_request_template.md is missing decision state: ${state}`);
  }
}

// 5. The workflow invokes the canonical CI command, and package.json defines it.
if (!missing.includes(WORKFLOW) && !read(WORKFLOW).includes(CANONICAL_CI)) {
  fail(`${WORKFLOW} must run the canonical command \`${CANONICAL_CI}\``);
}
const pkg = JSON.parse(read("package.json"));
for (const name of REQUIRED_SCRIPTS) {
  if (!pkg.scripts?.[name]) fail(`package.json is missing the \`${name}\` script`);
}
// `verify:ci` must keep every stage, in order — otherwise a stage can be
// dropped while this checker still reports the contract intact. The build
// precedes the tests because several suites read `.output/`.
const verify = pkg.scripts?.["verify:ci"];
if (verify) {
  const positions = CI_STAGES.map((stage) => [stage, verify.indexOf(stage)]);
  positions
    .filter(([, at]) => at === -1)
    .forEach(([stage]) => fail(`\`verify:ci\` must run \`${stage}\``));
  const present = positions.filter(([, at]) => at !== -1);
  const ordered = present.every(([, at], index) => index === 0 || at > present[index - 1][1]);
  if (!ordered) fail(`\`verify:ci\` must run its stages in order: ${CI_STAGES.join(" → ")}`);
}

// 6. No process file authorizes a merge, a force push, a deployment or credential use.
for (const file of SCANNED_FILES) {
  if (missing.includes(file)) continue;
  const text = read(file);
  for (const [pattern, why] of FORBIDDEN) {
    const match = text.match(new RegExp(pattern, "i"));
    if (match) fail(`${file} contains \`${match[0]}\` — ${why}`);
  }
}

if (failures.length > 0) {
  console.error("process:check FAILED\n");
  failures.forEach((message) => console.error(`  - ${message}`));
  console.error(`\n${failures.length} problem(s). Contract: docs/FOREVER_DEVELOPMENT_WORKFLOW.md`);
  process.exit(1);
}

console.log(`process:check PASSED — ${REQUIRED_FILES.length} process files verified`);
