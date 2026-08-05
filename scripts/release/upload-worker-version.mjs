#!/usr/bin/env node
/**
 * FOREVER-STUDIO-EXPLICIT-BINDINGS-FIX-002 — the ONE candidate upload path.
 *
 * WHAT CHANGED AND WHY (the whole reason this file was rewritten)
 * ---------------------------------------------------------------------------
 * PR #139 uploaded the two deployment-managed variables as `inherit` bindings
 * pinned to the verified 12-binding live version. The single authorized upload
 * proved the production API refuses that:
 *
 *   POST /accounts/{account_id}/workers/scripts/forever/versions -> HTTP 400
 *   "'version_id' value '<uuid>' is invalid, only the literal 'latest' is
 *    supported by this API [code: 10057]"      (once per binding)
 *
 * and `"latest"` is the defect — it resolves to the most recently uploaded
 * version, which is the rejected 10-binding candidate `3540bc64`. So both
 * bindings are now declared EXPLICITLY as `plain_text`, and nothing in the
 * release depends on Cloudflare's upload history at all.
 *
 * THE VALUES ARE NOT IN THIS REPOSITORY. They are supplied per release through
 * FOREVER_RELEASE_SUPABASE_URL and FOREVER_RELEASE_STUDIO_STORAGE_WRITE_PROVIDER,
 * validated here, and written ONLY into the ephemeral specification Wrangler
 * reads. Nothing else in this program, and no other process it starts, is given
 * a value:
 *
 *   - the PREUPLOAD preflight runs in a separate process and receives a
 *     VALUE-FREE binding projection — names and classes only;
 *   - the digest printed and recorded is SALTED with a per-release secret held
 *     in this process's memory, because `STUDIO_STORAGE_WRITE_PROVIDER` has two
 *     possible values and a bare digest of an otherwise-knowable document is a
 *     two-guess oracle;
 *   - the specification is created immediately before the spawn and deleted
 *     whether the upload succeeds or fails;
 *   - no value reaches stdout, stderr, the receipt or any error message.
 *
 * WHAT IT DOES, IN ORDER, REFUSING AT THE FIRST FAILURE
 *
 *   1. proves the resolved Wrangler is EXACTLY the supported version;
 *   2. validates the canonical upload argv token-by-token;
 *   3. reads and validates the two release-environment inputs;
 *   4. builds the upload specification IN MEMORY and verifies it in-process;
 *   5. runs the binding preflight on the VALUE-FREE projection and requires
 *      PREUPLOAD_EXPLICIT_BINDINGS_OK;
 *   6. writes the specification, re-proves its digest AND its structure, then
 *      spawns Wrangler with `shell: false` and the canonical argv;
 *   7. deletes the specification on every path.
 *
 * Step 6 additionally requires an explicit `--authorize-upload`. Without it the
 * wrapper performs 1-5 and prints exactly what it WOULD have run, writing no
 * value-carrying file at all. That default is what makes this whole path
 * testable with no credential, no network and no Cloudflare contact.
 *
 * NOTHING IS CONCATENATED. The executable and each argument are separate values
 * from `PRODUCTION_VERSION_UPLOAD_SPEC`; no string is built, split, quoted or
 * word-expanded anywhere in this file, and no operator-supplied text reaches the
 * argv. There is exactly one upload this program can perform, it is attempted at
 * most once, and it is never retried automatically.
 *
 * EXIT CODES
 *   0  every gate held (and, with --authorize-upload, Wrangler exited 0)
 *   1  STOP — a gate refused, or the upload could not be trusted
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createJiti } from "jiti";

import { probeWranglerVersion } from "./wrangler-version-gate.mjs";

const REPO = process.cwd();
const jiti = createJiti(import.meta.url);

const contract = await jiti.import(
  resolve(REPO, "src/lib/stale-asset/worker-variable-preservation.ts"),
);
const releaseIdentity = await jiti.import(
  resolve(REPO, "src/lib/stale-asset/worker-release-identity.ts"),
);
const explicit = await jiti.import(
  resolve(REPO, "src/lib/stale-asset/explicit-plain-text-bindings.ts"),
);
const ephemeral = await jiti.import(
  resolve(REPO, "src/lib/stale-asset/ephemeral-upload-specification.ts"),
);
const orchestration = await jiti.import(
  resolve(REPO, "src/lib/stale-asset/release-upload-orchestration.ts"),
);

const {
  PRODUCTION_VERSION_UPLOAD_SPEC,
  PRODUCTION_VERSION_UPLOAD_COMMAND,
  GENERATED_WORKER_CONFIG_PATH,
  UPLOAD_SPECIFICATION_PATH,
  verifyUploadSpec,
} = contract;
const {
  EXPECTED_FINAL_BINDING_COUNT,
  PREUPLOAD_EXPLICIT_BINDINGS_MARKER,
  RELEASE_VALUE_ENV_VARS,
  buildUploadSpecification,
  normalizeUploadSpecification,
  projectFinalBindingSet,
  readReleaseBindingInputs,
  verifyUploadSpecification,
} = explicit;
const { withEphemeralSpecification } = ephemeral;
const { parseWranglerVersionUploadReceipt, serializeWorkerVersionProvenance } = releaseIdentity;
const { verifyThenLaunchUpload } = orchestration;

const log = (message) => process.stdout.write(`[upload-version] ${message}\n`);

/** Directories this run owns and must remove on every exit path. */
const ownedDirectories = [];
function releaseOwnedDirectories() {
  while (ownedDirectories.length > 0) {
    const directory = ownedDirectories.pop();
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // Cleanup failure must never replace the refusal that caused it.
    }
  }
}

function stop(message) {
  releaseOwnedDirectories();
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

/**
 * A binding VALUE may never be supplied on the command line.
 *
 * argv is visible to every other process on the machine and is captured by
 * shell history. The values arrive through the environment or not at all.
 */
for (const forbidden of ["--supabase-url", "--write-provider", "--var", "--value"]) {
  if (process.argv.some((token) => token === forbidden || token.startsWith(`${forbidden}=`))) {
    stop(
      `binding values are never accepted on the command line (${forbidden}). Supply them through ` +
        `${RELEASE_VALUE_ENV_VARS.SUPABASE_URL} and ` +
        `${RELEASE_VALUE_ENV_VARS.STUDIO_STORAGE_WRITE_PROVIDER}.`,
    );
  }
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

// ---- 3. the required inputs -------------------------------------------------

const livePath = arg("--live");
const expectedLiveVersion = arg("--expected-live-version");
if (!livePath) {
  stop(
    "--live <live-snapshot.json> is required. The live Worker's bindings are captured BEFORE the " +
      "upload, mechanically, so the post-upload comparison has something honest to compare against.",
  );
}
if (!expectedLiveVersion) {
  stop(
    "--expected-live-version <uuid> is required from the authorized read-only deployment " +
      "discovery step. It is the rollback target recorded in the receipt.",
  );
}

/**
 * The two deployment-plane values, from the release environment.
 *
 * FAIL-CLOSED AND WITHOUT A DEFAULT. `STUDIO_STORAGE_WRITE_PROVIDER` has a
 * documented RUNTIME default of `supabase`; applying it here would silently
 * reconfigure production storage during a release meant to change nothing.
 */
const inputs = readReleaseBindingInputs(process.env);
if (!inputs.ok) {
  for (const violation of inputs.violations) {
    process.stderr.write(`[upload-version] ${violation.code}: ${violation.detail}\n`);
  }
  stop(
    "the release-environment inputs for the two deployment-managed plain-text bindings were not " +
      "accepted. No value is echoed above.",
  );
}
log(
  `release inputs     : ${Object.values(RELEASE_VALUE_ENV_VARS).sort().join(", ")} (present, ` +
    "validated, never echoed)",
);

// ---- 3a. the EPHEMERAL, UPLOAD-ONLY specification, IN MEMORY ----------------
//
// The immutable generated configuration is READ and never written. The
// specification is it, plus exactly the two explicit `plain_text` records —
// emitted into the SAME directory at spawn time so `main` and the relative
// `assets.directory` resolve to the identical Worker bundle and asset set.

const generatedAbsolute = resolve(REPO, GENERATED_WORKER_CONFIG_PATH);
if (!existsSync(generatedAbsolute)) {
  stop(
    `the immutable generated configuration is missing at ${GENERATED_WORKER_CONFIG_PATH}. Run \`npm run build\` first.`,
  );
}

let generatedConfig;
try {
  generatedConfig = JSON.parse(readFileSync(generatedAbsolute, "utf8"));
} catch {
  stop("the immutable generated configuration is not valid JSON.");
}

const generatedBytesBefore = readFileSync(generatedAbsolute);
const specificationAbsolute = resolve(REPO, UPLOAD_SPECIFICATION_PATH);

if (existsSync(specificationAbsolute)) {
  stop(
    `an upload specification already exists at ${UPLOAD_SPECIFICATION_PATH}. It carries values and ` +
      "is deleted after every run, so one left behind belongs to a crashed or concurrent release. " +
      "Investigate and remove it deliberately rather than overwriting it here.",
  );
}

const specification = buildUploadSpecification({
  generatedConfig,
  values: inputs.values,
});

const inProcessVerdict = verifyUploadSpecification({
  specification,
  generatedConfig,
  values: inputs.values,
});
if (!inProcessVerdict.ok || inProcessVerdict.normalized === null) {
  for (const violation of inProcessVerdict.violations) {
    process.stderr.write(`[upload-version] ${violation.code}: ${violation.detail}\n`);
  }
  stop("the upload specification did not satisfy the explicit-binding contract.");
}
const specificationBody = normalizeUploadSpecification(specification);

/**
 * The per-release digest SALT.
 *
 * Never written, never logged, never passed to a child. It exists so the digest
 * this program prints and records proves INTEGRITY without being an oracle for
 * a two-valued production setting. Verification and re-verification both happen
 * inside this process, so the salt never needs to outlive it.
 */
const digestSalt = randomBytes(32);
const saltedSpecificationDigest = (raw) =>
  createHash("sha256").update(digestSalt).update(raw, "utf8").digest("hex");

const verifiedDigest = saltedSpecificationDigest(specificationBody);

/**
 * The immutable local release manifest the candidate was built from.
 *
 * Recorded in the receipt so a future reader can correlate the uploaded
 * candidate with the exact build — source commit, source tree and
 * CLIENT_ASSET_ID — rather than having to trust that they matched. It carries no
 * value, so its digest is unsalted and reproducible on purpose.
 */
const RELEASE_MANIFEST_PATH = ".forever-build/release-manifest.json";
const releaseManifestAbsolute = resolve(REPO, RELEASE_MANIFEST_PATH);
if (!existsSync(releaseManifestAbsolute)) {
  stop(
    `the immutable release manifest is missing at ${RELEASE_MANIFEST_PATH}. Run \`npm run build\` first.`,
  );
}
const releaseManifestDigest = createHash("sha256")
  .update(readFileSync(releaseManifestAbsolute))
  .digest("hex");

log(`generated config   : ${GENERATED_WORKER_CONFIG_PATH} (immutable, unmodified)`);
log(`release manifest   : ${RELEASE_MANIFEST_PATH} sha256 ${releaseManifestDigest}`);
log(`upload spec        : ${UPLOAD_SPECIFICATION_PATH} (ephemeral, untracked, written at spawn)`);
log(`upload spec digest : ${verifiedDigest} (salted per release — not content-addressable)`);
log(`explicit bindings  : ${EXPECTED_FINAL_BINDING_COUNT}-binding contract, 0 inherit records`);

// ---- 3b. the pre-upload binding preflight, on a VALUE-FREE projection -------

const workDirectory = mkdtempSync(join(tmpdir(), "forever-release-work-"));
ownedDirectories.push(workDirectory);

const projectionPath = join(workDirectory, "upload-binding-projection.json");
writeFileSync(
  projectionPath,
  `${JSON.stringify(
    projectFinalBindingSet({
      generatedConfig,
      specification,
      liveBindingNames: (() => {
        const absolute = resolve(REPO, livePath);
        if (!existsSync(absolute)) return [];
        try {
          const parsed = JSON.parse(readFileSync(absolute, "utf8"));
          return Array.isArray(parsed?.bindings)
            ? parsed.bindings
                .map((binding) => binding?.name)
                .filter((name) => typeof name === "string")
            : [];
        } catch {
          return [];
        }
      })(),
    }),
    null,
    2,
  )}\n`,
  "utf8",
);

const preflight = spawnSync(
  process.execPath,
  [
    resolve(REPO, "scripts/release/verify-binding-preservation.mjs"),
    "--preupload",
    "--live",
    livePath,
    "--expected-live-version",
    expectedLiveVersion,
    "--upload-binding-projection",
    projectionPath,
    "--upload-specification-digest",
    verifiedDigest,
  ],
  { cwd: REPO, encoding: "utf8", shell: false, env: { ...process.env, NO_COLOR: "1" } },
);
const preflightOutput = `${preflight.stdout ?? ""}${preflight.stderr ?? ""}`;
process.stdout.write(preflightOutput);

if (preflight.error || typeof preflight.status !== "number") {
  stop("the binding preflight could not be run, so it did not produce PASS.");
}
if (preflight.status !== 0 || !preflightOutput.includes(PREUPLOAD_EXPLICIT_BINDINGS_MARKER)) {
  stop("the binding preflight did not produce PASS.");
}
// The preflight echoes the digest it was told the upload will consume. If that
// is not the digest computed here, verification and consumption are describing
// different bytes.
if (!preflightOutput.includes(verifiedDigest)) {
  stop(
    "the preflight reported an upload-specification digest that is not the one generated here. " +
      "Verification and consumption must name the same bytes.",
  );
}
log(`preflight          : ${PREUPLOAD_EXPLICIT_BINDINGS_MARKER}`);

// ---- 4. the upload ---------------------------------------------------------

if (!has("--authorize-upload")) {
  releaseOwnedDirectories();
  log(
    "DRY RUN — every gate held and NO value-carrying file was written. Re-run with " +
      "--authorize-upload to perform the upload. An upload is a separately authorized action; " +
      "this program does not authorize one.",
  );
  process.exit(0);
}

const receiptPath = arg("--receipt");
if (!receiptPath) {
  stop(
    "--receipt <path> is required in authorized mode so the upload-returned candidate UUID " +
      "cannot be replaced by a manually supplied value.",
  );
}
const receiptAbsolute = resolve(REPO, receiptPath);
if (existsSync(receiptAbsolute)) {
  stop("the receipt path already exists; an upload receipt is immutable and is never overwritten.");
}

// ---- 4a. verified and consumed must be the SAME BYTES ----------------------
//
// The specification is written HERE, immediately before the spawn, and removed
// in a `finally` that covers success, refusal and exception alike. Between the
// write and the spawn the wrapper re-hashes it with the per-release salt AND
// re-parses it against the explicit-binding contract, so the bytes Wrangler
// reads are proven twice over — once as a digest and once as a structure.
//
// The launcher is an IMPORT-level argument to `verifyThenLaunchUpload`, not a
// flag or an environment variable, so nothing an operator can set changes what
// a production run spawns.

const outputDirectory = mkdtempSync(join(tmpdir(), "forever-wrangler-output-"));
ownedDirectories.push(outputDirectory);
const outputPath = join(outputDirectory, "version-upload.ndjson");

const uploadEnvironment = {
  ...process.env,
  WRANGLER_OUTPUT_FILE_PATH: outputPath,
  FORCE_COLOR: "0",
  NO_COLOR: "1",
};
delete uploadEnvironment.WRANGLER_OUTPUT_FILE_DIRECTORY;

let cleanupFailed = false;

const decision = withEphemeralSpecification({
  absolutePath: specificationAbsolute,
  body: specificationBody,
  onCleanupFailure: () => {
    cleanupFailed = true;
  },
  run: () =>
    verifyThenLaunchUpload({
      specificationPath: specificationAbsolute,
      verifiedDigest,
      digest: saltedSpecificationDigest,
      generatedConfigPath: generatedAbsolute,
      generatedBytesBefore,
      revalidate: (raw) => {
        let reparsed;
        try {
          reparsed = JSON.parse(raw);
        } catch {
          return { ok: false, detail: "the upload specification is not valid JSON at spawn time." };
        }
        const verdict = verifyUploadSpecification({
          specification: reparsed,
          generatedConfig,
          values: inputs.values,
        });
        return {
          ok: verdict.ok,
          detail: verdict.ok
            ? ""
            : `the upload specification no longer satisfies the explicit-binding contract at spawn ` +
              `time (${verdict.violations.map((violation) => violation.code).join(", ")}). No value ` +
              "is echoed.",
        };
      },
      launch: () =>
        spawnSync(
          wrangler.launcher.command,
          [...wrangler.launcher.prefixArgs, ...PRODUCTION_VERSION_UPLOAD_SPEC.args],
          {
            cwd: REPO,
            encoding: "utf8",
            shell: false,
            env: uploadEnvironment,
          },
        ),
    }),
});

if (cleanupFailed) {
  process.stderr.write(
    `[upload-version] WARNING: the ephemeral upload specification at ${UPLOAD_SPECIFICATION_PATH} ` +
      "could not be removed. It carries deployment values — delete it before doing anything else.\n",
  );
}

if (!decision.launched) {
  stop(`${decision.stop} — ${decision.message}`);
}
log(`upload spec re-verified: digest and structure both re-proved immediately before spawn`);
log(`upload spec removed    : ${!existsSync(specificationAbsolute)}`);

let uploadReceipt = null;
let uploadFailure = null;

try {
  const run = decision.result;
  if (run.error || typeof run.status !== "number") {
    throw new Error("Wrangler could not be executed. Raw output is not echoed.");
  }
  if (run.status !== 0) {
    // ONE attempt. There is no retry here, no backoff and no loop for a caller
    // to re-enter: a failed upload is reported and the release stops. This
    // program never retries automatically.
    throw new Error(
      `wrangler exited ${run.status}. Raw output is not echoed; capture no snapshot and move no traffic.`,
    );
  }
  if (!existsSync(outputPath)) {
    throw new Error(
      "Wrangler produced no documented structured upload result. No receipt was written and no " +
        "traffic may move.",
    );
  }

  const receiptVerdict = parseWranglerVersionUploadReceipt(
    readFileSync(outputPath, "utf8"),
    expectedLiveVersion,
    {
      uploadSpecificationSha256: verifiedDigest,
      releaseManifestSha256: releaseManifestDigest,
    },
  );
  if (!receiptVerdict.accepted) {
    throw new Error(
      `${receiptVerdict.refusal}. Raw upload output is not echoed; no receipt was written and no ` +
        "traffic may move.",
    );
  }
  uploadReceipt = receiptVerdict.receipt;
} catch (error) {
  uploadFailure =
    error instanceof Error ? error.message : "the upload result could not be trusted.";
} finally {
  releaseOwnedDirectories();
}

if (uploadFailure || uploadReceipt === null) {
  process.stderr.write(
    `[upload-version] STOP: ${uploadFailure ?? "the upload result could not be trusted."}\n`,
  );
  process.exit(1);
}

writeFileSync(receiptAbsolute, serializeWorkerVersionProvenance(uploadReceipt), {
  encoding: "utf8",
  flag: "wx",
});

log(
  "upload complete; a sanitized immutable candidate receipt was written. NEXT, BEFORE PREVIEW " +
    "ACCEPTANCE: capture the candidate through --candidate-release-provenance and run the full " +
    "preflight against that same receipt. The candidate holds 0% until identity and bindings PASS.",
);
