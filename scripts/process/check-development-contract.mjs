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
 * The workflow lint gate. `quality-gate` is the only place a GitHub Actions
 * change is mechanically checked, so the properties that make that check
 * trustworthy are asserted here rather than left to review:
 *
 *   1. actionlint actually LINTS — the step is not reduced to a version print,
 *      not narrowed with file arguments that would exclude a workflow added
 *      later, and not neutered so its exit code stops failing the job;
 *   2. it is pinned to an exact release version, never `latest`;
 *   3. the archive is checksum-verified before it is extracted or executed;
 *   4. it runs BEFORE the canonical verification, so a broken workflow fails
 *      in seconds instead of after a full `verify:ci`.
 *
 * Every marker below is matched INSIDE the step, never anywhere in the file: a
 * mention in a comment, or an unrelated `tar`, must not satisfy one. The
 * version and digest are matched by shape rather than by literal value, so an
 * upgrade is a workflow edit rather than a change here.
 */
const STEP_HEADER = /^[ \t]*- name:/m;
const ACTIONLINT_STEP_HEADER = /^[ \t]*- name:[^\n]*actionlint\b/im;
const ACTIONLINT_BINARY = '"${RUNNER_TEMP}/actionlint"';
/**
 * The lint invocation itself: the binary, optional flags, and NOTHING else. It
 * deliberately does not match `-version` (which prints a version and lints
 * nothing), a file argument (which would silently exclude a workflow added
 * later), or a trailing `|| true`.
 */
const ACTIONLINT_LINT_CALL =
  /^[ \t]*"\$\{RUNNER_TEMP\}\/actionlint"(?:[ \t]+-(?!version\b)[a-z-]+)*[ \t]*$/m;
const ACTIONLINT_VERSION_PIN = /^\s*ACTIONLINT_VERSION:\s*\d+\.\d+\.\d+\s*$/m;
const ACTIONLINT_SHA256_PIN = /^\s*ACTIONLINT_SHA256:\s*[0-9a-f]{64}\s*$/m;
const ACTIONLINT_CHECKSUM_CHECK = /sha256sum\s+--check\s+--strict/;
const ACTIONLINT_EXTRACT = /^\s*tar\s/m;
/** Without it, a failed download or a mismatched digest does not abort the step. */
const ACTIONLINT_ABORTS = /^\s*set -euo pipefail\s*$/m;
/** The release asset and its URL must both be derived from the pinned version. */
const ACTIONLINT_DERIVED = [
  "actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz",
  "releases/download/v${ACTIONLINT_VERSION}/",
];
/** Ways a step stays in the file while losing the power to fail the job. */
const NEUTERED = [
  [/^\s*if:/m, "a step-level `if:` can switch the lint off"],
  [/\|\|\s*true/, "`|| true` swallows the exit code"],
  [/set\s+\+e\b/, "`set +e` stops a failure from failing the step"],
];
/** A remote script piped into a shell cannot be checksum-verified at all. */
const PIPE_INTO_SHELL = /(curl|wget)[^\n]*\|[ \t]*(ba)?sh\b/;
/**
 * The step that actually runs the canonical command. The ordering assertion
 * needs the invocation, not the prose mention of it in the file header.
 */
const CANONICAL_CI_STEP = new RegExp(
  `^\\s*run:\\s*${CANONICAL_CI.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
  "m",
);

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

// 6. `quality-gate` lints every workflow file with a pinned, checksum-verified
//    actionlint, before the canonical verification.
if (!missing.includes(WORKFLOW)) {
  const workflow = read(WORKFLOW);
  const stepAt = workflow.search(ACTIONLINT_STEP_HEADER);
  const runsCanonical = workflow.search(CANONICAL_CI_STEP);

  if (stepAt === -1) fail(`${WORKFLOW} must carry a step that installs and runs actionlint`);
  // Job- or step-level, it turns the one canonical gate into an advisory one.
  if (workflow.includes("continue-on-error")) {
    fail(`${WORKFLOW} must not use \`continue-on-error\`; the gate either passes or fails`);
  }
  if (PIPE_INTO_SHELL.test(workflow)) {
    fail(`${WORKFLOW} pipes a remote script into a shell; install a checksum-verified binary`);
  }
  // Without the canonical step there is nothing to order actionlint against,
  // so its absence is a failure here too, not a silently skipped assertion.
  if (runsCanonical === -1) {
    fail(`${WORKFLOW} must run \`${CANONICAL_CI}\` as a step, so actionlint can precede it`);
  } else if (stepAt > runsCanonical) {
    fail(`${WORKFLOW} must run actionlint BEFORE \`${CANONICAL_CI}\``);
  }

  if (stepAt > -1) {
    // The step body: everything after its `- name:` line, up to the next step.
    const headerEnd = workflow.indexOf("\n", stepAt);
    const tail = headerEnd === -1 ? "" : workflow.slice(headerEnd + 1);
    const nextAt = tail.search(STEP_HEADER);
    const step = nextAt === -1 ? tail : tail.slice(0, nextAt);

    const lints = step.search(ACTIONLINT_LINT_CALL);
    const executes = step.indexOf(ACTIONLINT_BINARY);
    const checksAsset = step.search(ACTIONLINT_CHECKSUM_CHECK);
    const extracts = step.search(ACTIONLINT_EXTRACT);

    if (lints === -1) {
      fail(
        `${WORKFLOW} must run ${ACTIONLINT_BINARY} with no file arguments — a version print, ` +
          `a named file, or a swallowed exit code lints nothing that arrives later`,
      );
    }
    if (!ACTIONLINT_ABORTS.test(step)) {
      fail(`${WORKFLOW}: the actionlint step must \`set -euo pipefail\` so a bad download aborts`);
    }
    NEUTERED.filter(([pattern]) => pattern.test(step)).forEach(([, why]) =>
      fail(`${WORKFLOW}: the actionlint step is neutered — ${why}`),
    );
    if (!ACTIONLINT_VERSION_PIN.test(step)) {
      fail(`${WORKFLOW} must pin actionlint to an exact version via \`ACTIONLINT_VERSION\``);
    }
    if (!ACTIONLINT_SHA256_PIN.test(step)) {
      fail(`${WORKFLOW} must pin the actionlint archive digest via \`ACTIONLINT_SHA256\``);
    }
    ACTIONLINT_DERIVED.filter((token) => !step.includes(token)).forEach((token) =>
      fail(`${WORKFLOW} must derive the actionlint download from the pinned version: \`${token}\``),
    );
    if (checksAsset === -1) {
      fail(`${WORKFLOW} must verify the actionlint archive with \`sha256sum --check --strict\``);
    }
    // A checksum verified after extraction or execution proves nothing: the
    // untrusted bytes already ran.
    if (checksAsset > -1 && extracts > -1 && checksAsset > extracts) {
      fail(`${WORKFLOW} must verify the actionlint checksum BEFORE extracting the archive`);
    }
    if (checksAsset > -1 && executes > -1 && checksAsset > executes) {
      fail(`${WORKFLOW} must verify the actionlint checksum BEFORE executing the binary`);
    }
  }
}

// 7. No process file authorizes a merge, a force push, a deployment or credential use.
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
