#!/usr/bin/env node
/**
 * FOREVER-WRANGLER-KEEP-VARS-CORRECTION-001 — fail-closed release preflight.
 * Corrected by FOREVER-PR138-MERGE-BLOCKER-CORRECTION-002.
 *
 * Run BEFORE any future candidate is promoted. It answers one question:
 *
 *   does the candidate carry EXACTLY the bindings the live Worker carries?
 *
 * Candidate `ae4cae19` did not. It lost SUPABASE_URL and
 * STUDIO_STORAGE_WRITE_PROVIDER because Wrangler deletes deployment-managed
 * vars unless the upload passes `--keep-vars`, and it returned HTTP 500 on its
 * preview. It was caught at 0% and no traffic moved.
 *
 * WHAT THE PR138 REVIEW CHANGED HERE
 * ----------------------------------
 * P1-1. `--command` accepted arbitrary operator text and the contract checked it
 *   with `includes("--keep-vars")`. That flag is now supplied as a STRUCTURED
 *   specification validated token-by-token, and the free-text path is gone.
 * P2-1. The loader read `parsed?.bindings` and ignored every other top-level
 *   key, so a capture storing values beside the array passed. Both inputs are
 *   now validated against a CLOSED, versioned schema.
 * P2-2. Duplicate names passed, and fingerprint equality was computed, printed
 *   and then left out of the pass condition. Both are refusals now.
 *
 * THIS SCRIPT CONTACTS NOTHING. It reads two sanitized snapshots produced by
 * `capture-worker-version-bindings.mjs` plus the local generated deploy
 * configuration. It performs no network call and reads no credential.
 *
 * SECRET VALUES ARE NEVER READ, PRINTED OR PERSISTED. The snapshot format is
 * name plus class only. A value appearing in an input is itself a STOP.
 *
 * USAGE
 *   node scripts/release/verify-binding-preservation.mjs \
 *     --live <live-snapshot.json> --candidate <candidate-snapshot.json> \
 *     --release-provenance <worker-version-provenance.json> \
 *     [--generated .output/server/wrangler.json] \
 *     [--upload-spec <upload-spec.json>] [--json <report-out.json>]
 *
 *   node scripts/release/verify-binding-preservation.mjs --preupload \
 *     --live <live-snapshot.json> \
 *     --expected-live-version <deployed-worker-version-uuid>
 *
 * INPUT SHAPE (both snapshots, exactly — no other key is accepted)
 *   { "schemaVersion": 1,
 *     "workerVersionId": "<worker-version-uuid>",
 *     "bindings": [ { "name": "SUPABASE_URL", "type": "plain_text" } ] }
 *
 * EXIT CODES
 *   0  every binding preserved and the keep-vars contract holds
 *   1  STOP — a violation was found, or an input could not be trusted
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createJiti } from "jiti";

const REPO = process.cwd();
const jiti = createJiti(import.meta.url);

/** ONE source of truth: the same contract the test suite asserts. */
const contract = await jiti.import(
  resolve(REPO, "src/lib/stale-asset/worker-variable-preservation.ts"),
);
const capture = await jiti.import(resolve(REPO, "src/lib/stale-asset/worker-binding-capture.ts"));
const releaseIdentity = await jiti.import(
  resolve(REPO, "src/lib/stale-asset/worker-release-identity.ts"),
);

const {
  DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS,
  DEPLOYMENT_MANAGED_SECRET_BINDINGS,
  EXPECTED_PRODUCTION_BINDING_COUNT,
  PRODUCTION_VERSION_UPLOAD_SPEC,
  expectedProductionBindings,
  verifyBindingPreservation,
  verifyKeepVarsContract,
  verifyUploadSpec,
} = contract;

const { validateBindingSnapshot } = capture;
const { isWorkerVersionId, verifyWorkerVersionProvenance } = releaseIdentity;

const log = (message) => process.stdout.write(`[release-preflight] ${message}\n`);

const schemaViolations = [];
const versionViolations = [];

function fail(message) {
  process.stderr.write(`[release-preflight] STOP: ${message}\n`);
  process.exitCode = 1;
  return null;
}

function arg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
const has = (flag) => process.argv.includes(flag);

/**
 * The free-text escape path, refused loudly rather than silently ignored.
 *
 * A runbook or script still passing `--command "wrangler versions upload …"`
 * would otherwise be accepted with the flag simply unread, which is exactly the
 * silent weakening this correction exists to prevent.
 */
if (has("--command")) {
  process.stderr.write(
    "[release-preflight] STOP: `--command` no longer exists. A shell command STRING cannot be " +
      "validated — `--keep-vars=false`, `--keep-vars-disabled`, a `#` comment and text after a " +
      "`--` terminator all contain the substring and all DELETE deployment-managed variables. " +
      "Use --upload-spec <json> carrying { executable, args }.\n",
  );
  process.exit(1);
}

/**
 * Loads one sanitized snapshot and validates it against the CLOSED schema.
 *
 * Every refusal names a violation category and a position. A rejected value is
 * never echoed — a capture that stored a token beside the array must not have
 * it reprinted into an evidence file by the guard that caught it.
 */
function loadSnapshot(path, label) {
  if (!path) return fail(`${label} snapshot path not supplied.`);
  const absolute = resolve(REPO, path);
  if (!existsSync(absolute)) return fail(`${label} snapshot not found at ${path}.`);

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    schemaViolations.push({
      code: "snapshot_schema_invalid",
      binding: `(${label})`,
      detail: `${label} snapshot is not valid JSON. The document is not echoed.`,
    });
    return fail(`${label} snapshot is not valid JSON.`);
  }

  const verdict = validateBindingSnapshot(parsed);
  if (!verdict.ok) {
    for (const problem of verdict.problems) {
      schemaViolations.push({
        code: "snapshot_schema_invalid",
        binding: `(${label})`,
        detail: `${problem.code}: ${problem.detail}`,
      });
      log(`  snapshot_schema_invalid [${label}] ${problem.code}: ${problem.detail}`);
    }
    return fail(`${label} snapshot does not satisfy the closed binding-snapshot schema.`);
  }
  return verdict.snapshot;
}

const preuploadOnly = has("--preupload");

const liveSnapshot = loadSnapshot(arg("--live"), "live");
const candidateSnapshot = preuploadOnly ? null : loadSnapshot(arg("--candidate"), "candidate");
if (!liveSnapshot || (!preuploadOnly && !candidateSnapshot)) {
  log("refusing to report a verdict on untrusted or missing input.");
  process.exit(1);
}

/** Descriptors and immutable version provenance are independent required inputs. */
const live = liveSnapshot.bindings;
const candidate = candidateSnapshot ? candidateSnapshot.bindings : null;

const addVersionViolation = (code, detail) => {
  versionViolations.push({ code, binding: "(release provenance)", detail });
  log(`  ${code}: ${detail}`);
};

let releaseProvenance = null;
let liveWorkerVersionMatches = false;
let candidateWorkerVersionMatches = preuploadOnly ? null : false;

if (preuploadOnly) {
  const expectedLiveVersion = arg("--expected-live-version");
  if (!expectedLiveVersion) {
    addVersionViolation(
      "release_provenance_missing",
      "the exact deployed Worker version UUID from discovery is required before upload.",
    );
  } else if (!isWorkerVersionId(expectedLiveVersion)) {
    addVersionViolation(
      "release_provenance_invalid",
      "the discovered live Worker version is not an immutable Worker UUID.",
    );
  } else if (liveSnapshot.workerVersionId !== expectedLiveVersion) {
    addVersionViolation(
      "live_worker_version_mismatch",
      "the live snapshot is not attributed to the exact discovered deployed Worker version.",
    );
    addVersionViolation(
      "snapshot_version_mismatch",
      "snapshot identity and expected live release identity differ.",
    );
  } else {
    liveWorkerVersionMatches = true;
  }
} else {
  if (resolve(REPO, arg("--live")) === resolve(REPO, arg("--candidate"))) {
    addVersionViolation(
      "same_snapshot_input",
      "the same snapshot file cannot stand for both previous and candidate Worker versions.",
    );
  }

  const provenancePath = arg("--release-provenance");
  if (!provenancePath) {
    addVersionViolation(
      "release_provenance_missing",
      "the mechanically generated candidate upload receipt is required after upload.",
    );
    addVersionViolation("candidate_receipt_missing", "no candidate upload receipt was supplied.");
  } else {
    const absolute = resolve(REPO, provenancePath);
    let parsed = null;
    if (!existsSync(absolute)) {
      addVersionViolation(
        "release_provenance_missing",
        "the candidate upload receipt was not found.",
      );
      addVersionViolation("candidate_receipt_missing", "no candidate upload receipt was found.");
    } else {
      try {
        parsed = JSON.parse(readFileSync(absolute, "utf8"));
      } catch {
        addVersionViolation(
          "release_provenance_invalid",
          "the candidate upload receipt is not valid JSON; its contents are not echoed.",
        );
      }
    }

    if (parsed !== null) {
      const provenanceVerdict = verifyWorkerVersionProvenance(parsed);
      if (!provenanceVerdict.accepted) {
        addVersionViolation(
          provenanceVerdict.refusal,
          "the candidate upload receipt failed the canonical release-identity contract.",
        );
      } else {
        releaseProvenance = provenanceVerdict.provenance;
        liveWorkerVersionMatches =
          liveSnapshot.workerVersionId === releaseProvenance.previousWorkerVersionId;
        candidateWorkerVersionMatches =
          candidateSnapshot.workerVersionId === releaseProvenance.candidateWorkerVersionId;
        if (!liveWorkerVersionMatches) {
          addVersionViolation(
            "live_worker_version_mismatch",
            "the live snapshot is not the exact previous Worker version in the upload receipt.",
          );
        }
        if (!candidateWorkerVersionMatches) {
          addVersionViolation(
            "candidate_worker_version_mismatch",
            "the candidate snapshot is not the exact Worker version returned by the upload.",
          );
        }
        if (!liveWorkerVersionMatches || !candidateWorkerVersionMatches) {
          addVersionViolation(
            "snapshot_version_mismatch",
            "one or both snapshot identities differ from the canonical release provenance.",
          );
        }
      }
    }
  }
}

// ---- the keep-vars contract, checked against what would actually be run -----

const generatedPath = arg("--generated") ?? ".output/server/wrangler.json";
const generatedAbsolute = resolve(REPO, generatedPath);
let generatedConfig = null;
if (existsSync(generatedAbsolute)) {
  try {
    generatedConfig = JSON.parse(readFileSync(generatedAbsolute, "utf8"));
  } catch {
    fail("generated deploy configuration is not valid JSON.");
  }
} else {
  fail(
    `generated deploy configuration not found at ${generatedPath}. Run \`npm run build\` first — a missing artefact is a STOP, never a skip.`,
  );
}

/**
 * The upload specification, as DATA.
 *
 * Defaults to the canonical one. An operator may pass a file to have their
 * proposed upload checked, but it is validated token-by-token against the
 * canonical argv, so the only file that passes is the canonical upload.
 */
let uploadSpec = PRODUCTION_VERSION_UPLOAD_SPEC;
const specPath = arg("--upload-spec");
if (specPath) {
  const specAbsolute = resolve(REPO, specPath);
  if (!existsSync(specAbsolute)) {
    fail(`upload specification not found at ${specPath}.`);
    uploadSpec = null;
  } else {
    try {
      uploadSpec = JSON.parse(readFileSync(specAbsolute, "utf8"));
    } catch {
      fail("upload specification is not valid JSON. The document is not echoed.");
      uploadSpec = null;
    }
  }
}

const specVerdict = verifyUploadSpec(uploadSpec);
const keepVars = generatedConfig
  ? verifyKeepVarsContract({ generatedConfig, uploadSpec })
  : { ok: false, reasons: ["generated deploy configuration unavailable"], specViolations: [] };

// ---- the binding comparison ------------------------------------------------

const verdict = candidate
  ? verifyBindingPreservation(live, candidate)
  : {
      ok: true,
      violations: [],
      liveFingerprint: "",
      candidateFingerprint: "",
      liveBindingCount: live.length,
      candidateBindingCount: 0,
    };

/** Required expected bindings, checked against the enumerated contract. */
const expectedMissing = candidate
  ? expectedProductionBindings()
      .filter(
        (expected) =>
          !candidate.some(
            (binding) => binding.name === expected.name && binding.type === expected.type,
          ),
      )
      .map((expected) => expected.name)
  : [];

const fingerprintsEqual = candidate
  ? verdict.liveFingerprint === verdict.candidateFingerprint
  : null;

log(`mode               : ${preuploadOnly ? "PRE-UPLOAD CONTRACT" : "LIVE vs CANDIDATE"}`);
log(`live bindings      : ${verdict.liveBindingCount}`);
if (candidate) log(`candidate bindings : ${verdict.candidateBindingCount}`);
log(`expected total     : ${EXPECTED_PRODUCTION_BINDING_COUNT}`);
if (candidate) log(`fingerprints equal : ${fingerprintsEqual}`);
log(`upload spec        : ${specVerdict.ok ? "CANONICAL" : "REFUSED"}`);
log(`keep-vars contract : ${keepVars.ok ? "OK" : "VIOLATED"}`);
log(`version identity    : ${versionViolations.length === 0 ? "PINNED" : "REFUSED"}`);

for (const reason of keepVars.reasons) log(`  keep-vars: ${reason}`);
for (const violation of verdict.violations) {
  log(`  ${violation.code}: ${violation.binding} — ${violation.detail}`);
}
for (const name of expectedMissing) {
  log(`  expected_binding_absent: ${name} — the enumerated production contract requires it.`);
}

// The one false negative this script exists to refuse.
if (candidate) {
  const secretsAllPresent = DEPLOYMENT_MANAGED_SECRET_BINDINGS.every((name) =>
    candidate.some((binding) => binding.name === name),
  );
  const plainTextMissing = DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS.filter(
    (name) => !candidate.some((binding) => binding.name === name),
  );
  if (secretsAllPresent && plainTextMissing.length > 0) {
    log(
      `NOTE: all ${DEPLOYMENT_MANAGED_SECRET_BINDINGS.length} secret bindings are present and ${plainTextMissing.length} plain-text variable(s) are NOT. ` +
        `Cloudflare never deletes secrets, so their survival proves nothing about vars. This is the ae4cae19 shape.`,
    );
  }
}

/**
 * Fingerprint equality is REQUIRED for a pass. Stated once, so the pass
 * condition and the reported contract cannot disagree: the previous script
 * computed equality, printed it, and then omitted it from the condition, which
 * is how PASS came to be printed in the same run as `fingerprintsEqual: false`.
 */
const FINGERPRINT_EQUALITY_REQUIRED = true;

/**
 * THE PASS CONDITION, in full.
 *
 * Every clause is required, including the fingerprint.
 */
const ok =
  schemaViolations.length === 0 &&
  versionViolations.length === 0 &&
  liveWorkerVersionMatches &&
  (preuploadOnly || (releaseProvenance !== null && candidateWorkerVersionMatches === true)) &&
  verdict.ok &&
  keepVars.ok &&
  specVerdict.ok &&
  expectedMissing.length === 0 &&
  (preuploadOnly || !FINGERPRINT_EQUALITY_REQUIRED || fingerprintsEqual === true) &&
  (preuploadOnly || verdict.candidateBindingCount === verdict.liveBindingCount);

const report = {
  task: "FOREVER-PR138-WORKER-VERSION-PINNING-CORRECTION-004",
  contactedProduction: false,
  secretValuesRead: 0,
  mode: preuploadOnly ? "PREUPLOAD" : "LIVE_VS_CANDIDATE",
  // Sanitized immutable ids only; no raw Wrangler output is retained here.
  liveWorkerVersionId: liveSnapshot.workerVersionId,
  candidateWorkerVersionId: candidateSnapshot ? candidateSnapshot.workerVersionId : null,
  previousWorkerVersionId: releaseProvenance?.previousWorkerVersionId ?? null,
  uploadedCandidateWorkerVersionId: releaseProvenance?.candidateWorkerVersionId ?? null,
  releaseProvenanceValid: preuploadOnly ? null : releaseProvenance !== null,
  liveWorkerVersionMatches,
  candidateWorkerVersionMatches,
  workerVersionIdentityOk: versionViolations.length === 0,
  liveBindingCount: verdict.liveBindingCount,
  candidateBindingCount: verdict.candidateBindingCount,
  expectedBindingCount: EXPECTED_PRODUCTION_BINDING_COUNT,
  snapshotSchemaValid: schemaViolations.length === 0,
  fingerprintsEqual,
  fingerprintEqualityRequiredForPass: FINGERPRINT_EQUALITY_REQUIRED,
  uploadSpecCanonical: specVerdict.ok,
  uploadSpecViolations: specVerdict.violations,
  keepVarsContractOk: keepVars.ok,
  keepVarsReasons: keepVars.reasons,
  expectedBindingsAbsent: expectedMissing,
  violations: [...schemaViolations, ...versionViolations, ...verdict.violations],
  verdict: ok ? (preuploadOnly ? "PREUPLOAD_CONTRACT_OK" : "BINDINGS_PRESERVED") : "STOP",
};

const jsonOut = arg("--json");
if (jsonOut) {
  writeFileSync(resolve(REPO, jsonOut), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  log(`report written to ${jsonOut}`);
}

if (!ok) {
  process.stderr.write(
    "[release-preflight] STOP — candidate REJECTED. A candidate whose binding set is not EXACTLY " +
      "the live Worker's is rejected even while it holds 0% of traffic. Do not move traffic.\n",
  );
  process.exit(1);
}

log(
  preuploadOnly
    ? "PASS (PREUPLOAD_CONTRACT_OK) — the live snapshot, the generated configuration and the " +
        "canonical upload specification all hold, pinned to the exact discovered live Worker " +
        "UUID. Upload may proceed."
    : "PASS — every live binding is preserved, both snapshots are pinned to the exact previous " +
        "and upload-returned Worker UUIDs, the fingerprints are EQUAL and the keep-vars contract " +
        "holds.",
);
