#!/usr/bin/env node
/**
 * FOREVER-PR138-MERGE-BLOCKER-CORRECTION-002 — the ONE candidate upload path.
 *
 * The independent review found no wrapper, no npm script and no workflow that
 * invoked Wrangler at all: the production upload was a line of prose in a
 * runbook, "protected" by a substring test that accepted ten commands which
 * delete deployment-managed variables. Prose cannot be validated, so the upload
 * is a program now, and this is it.
 *
 * WHAT IT DOES, IN ORDER, REFUSING AT THE FIRST FAILURE
 *
 *   1. proves the resolved Wrangler is EXACTLY the supported version;
 *   2. validates the canonical upload specification token-by-token;
 *   3. runs the binding preflight in pre-upload mode and requires
 *      PREUPLOAD_CONTRACT_OK — the live snapshot must parse against the closed
 *      schema and the generated configuration must carry `keep_vars: true`;
 *   4. only then spawns Wrangler, with `shell: false` and the canonical argv.
 *
 * Step 4 additionally requires an explicit `--authorize-upload`. Without it the
 * wrapper performs 1-3 and prints exactly what it WOULD have run. That default
 * is what makes this whole path testable with no credential, no network and no
 * Cloudflare contact — which is how it is tested.
 *
 * NOTHING IS CONCATENATED. The executable and each argument are separate
 * values from `PRODUCTION_VERSION_UPLOAD_SPEC`; no string is built, split,
 * quoted or word-expanded anywhere in this file, and no operator-supplied text
 * reaches the argv. There is exactly one upload this program can perform.
 *
 * AFTERWARDS, AND NOT HERE. A successful upload produces a NEW immutable Worker
 * version. Its bindings are captured with
 * `capture-worker-version-bindings.mjs` and compared with the full preflight
 * BEFORE preview acceptance. This wrapper moves no traffic and deploys nothing.
 *
 * EXIT CODES
 *   0  every gate held (and, with --authorize-upload, Wrangler exited 0)
 *   1  STOP — a gate refused, and Wrangler was NOT spawned
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { createJiti } from "jiti";

import { probeWranglerVersion } from "./wrangler-version-gate.mjs";

const REPO = process.cwd();
const jiti = createJiti(import.meta.url);

const contract = await jiti.import(
  resolve(REPO, "src/lib/stale-asset/worker-variable-preservation.ts"),
);
const { PRODUCTION_VERSION_UPLOAD_SPEC, PRODUCTION_VERSION_UPLOAD_COMMAND, verifyUploadSpec } =
  contract;

const log = (message) => process.stdout.write(`[upload-version] ${message}\n`);

function stop(message) {
  process.stderr.write(`[upload-version] STOP: ${message} Wrangler was NOT spawned.\n`);
  process.exit(1);
}

function arg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
const has = (flag) => process.argv.includes(flag);

/**
 * There is no operator-supplied command surface. `--command` is refused rather
 * than ignored, so a caller that still believes it can hand this program a
 * shell string learns that it cannot.
 */
if (has("--command") || has("--args") || has("--extra-args")) {
  stop(
    "this wrapper accepts no command, argument or flag pass-through. It performs exactly one " +
      "upload, defined by PRODUCTION_VERSION_UPLOAD_SPEC.",
  );
}

// ---- 1. the Wrangler version gate ------------------------------------------

const wrangler = probeWranglerVersion(REPO);
log(`wrangler supported : ${wrangler.supportedVersion}`);
log(`wrangler reported  : ${wrangler.reportedVersion ?? "(none)"}`);
if (!wrangler.ok) {
  for (const problem of wrangler.problems) process.stderr.write(`[upload-version] ${problem}\n`);
  stop("the Wrangler version gate refused.");
}

// ---- 2. the canonical specification ----------------------------------------

const specVerdict = verifyUploadSpec(PRODUCTION_VERSION_UPLOAD_SPEC);
if (!specVerdict.ok) {
  for (const violation of specVerdict.violations) {
    process.stderr.write(`[upload-version] ${violation.code}: ${violation.detail}\n`);
  }
  stop("the canonical upload specification did not validate against its own rules.");
}
log(`upload command     : ${PRODUCTION_VERSION_UPLOAD_COMMAND}`);
log(`argv               : ${JSON.stringify(PRODUCTION_VERSION_UPLOAD_SPEC.args)}`);
log(`shell              : false`);

// ---- 3. the pre-upload binding preflight -----------------------------------

const livePath = arg("--live");
if (!livePath) {
  stop(
    "--live <live-snapshot.json> is required. The live Worker's bindings are captured BEFORE the " +
      "upload, mechanically, so the post-upload comparison has something honest to compare against.",
  );
}

const preflight = spawnSync(
  process.execPath,
  [
    resolve(REPO, "scripts/release/verify-binding-preservation.mjs"),
    "--preupload",
    "--live",
    livePath,
  ],
  { cwd: REPO, encoding: "utf8", shell: false, env: { ...process.env, NO_COLOR: "1" } },
);
const preflightOutput = `${preflight.stdout ?? ""}${preflight.stderr ?? ""}`;
process.stdout.write(preflightOutput);

if (preflight.error || typeof preflight.status !== "number") {
  stop("the binding preflight could not be run, so it did not produce PASS.");
}
if (preflight.status !== 0 || !preflightOutput.includes("PREUPLOAD_CONTRACT_OK")) {
  stop("the binding preflight did not produce PASS.");
}
log("preflight          : PREUPLOAD_CONTRACT_OK");

// ---- 4. the upload ---------------------------------------------------------

if (!has("--authorize-upload")) {
  log(
    "DRY RUN — every gate held. Re-run with --authorize-upload to perform the upload. " +
      "An upload is a separately authorized action; this program does not authorize one.",
  );
  process.exit(0);
}

const run = spawnSync(
  wrangler.launcher.command,
  [...wrangler.launcher.prefixArgs, ...PRODUCTION_VERSION_UPLOAD_SPEC.args],
  { cwd: REPO, stdio: "inherit", shell: false },
);
if (run.error || typeof run.status !== "number") {
  stop("Wrangler could not be executed.");
}
if (run.status !== 0) {
  process.stderr.write(
    `[upload-version] STOP: wrangler exited ${run.status}. Capture no snapshot and move no traffic.\n`,
  );
  process.exit(1);
}

log(
  "upload complete. NEXT, BEFORE PREVIEW ACCEPTANCE: capture the new version's bindings with " +
    "`npm run release:capture-bindings` and run the full preflight against the live snapshot. " +
    "The candidate holds 0% until that comparison PASSES.",
);
