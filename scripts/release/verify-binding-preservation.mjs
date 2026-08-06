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
 *     --expected-live-version <deployed-worker-version-uuid> \
 *     --upload-binding-projection <value-free-projection.json> \
 *     --upload-specification-digest <salted-digest>
 *
 * WHAT PREUPLOAD NOW PROVES (FOREVER-STUDIO-EXPLICIT-BINDINGS-FIX-002)
 * ---------------------------------------------------------------------------
 * `PREUPLOAD_CONTRACT_OK` checked argv tokens and `keep_vars: true` — INTENT
 * only — and passed candidate `3540bc64`, whose generic inheritance resolved
 * against the failed 10-binding `ae4cae19`. `PREUPLOAD_PINNED_INHERITANCE_OK`
 * then proved the inheritance SOURCE was pinned to the verified 12-binding live
 * version, which was a true statement about a mechanism the production API
 * refuses: HTTP 400, code 10057, "only the literal 'latest' is supported".
 *
 * Inheritance is gone. Both variables are declared EXPLICITLY as `plain_text`
 * bindings, so PREUPLOAD now proves: the live snapshot IS the supplied
 * expected-live UUID; that version carries exactly the 12-binding contract
 * including both plain-text names; the projected upload carries ZERO inherit
 * records; the ten bindings that survive without explicit records are all
 * present; both explicit plain-text bindings are present with the right class;
 * no binding name is duplicated; no `vars` block exists; and the total is
 * exactly twelve.
 *
 * THIS PROCESS IS NEVER GIVEN A VALUE. It reasons about a VALUE-FREE
 * PROJECTION — names and classes only — produced by the upload wrapper, which
 * is the sole process permitted to hold `SUPABASE_URL` and
 * `STUDIO_STORAGE_WRITE_PROVIDER`. The specification digest is carried through
 * as an opaque token and re-proved by the wrapper against the real bytes
 * immediately before the spawn; it is SALTED per release, so it is an integrity
 * token rather than a content address of a document holding a two-valued
 * setting.
 *
 * The success marker is therefore `PREUPLOAD_EXPLICIT_BINDINGS_OK`. Neither
 * superseded marker is ever emitted again — reusing a name with changed
 * semantics would make every historical evidence file ambiguous.
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
const explicit = await jiti.import(
  resolve(REPO, "src/lib/stale-asset/explicit-plain-text-bindings.ts"),
);

const {
  EXPECTED_FINAL_BINDING_COUNT,
  PREUPLOAD_EXPLICIT_BINDINGS_MARKER,
  verifyFinalBindingProjection,
} = explicit;

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

// ---- the EXPLICIT BINDING contract -----------------------------------------
//
// FOREVER-STUDIO-EXPLICIT-BINDINGS-FIX-002. The superseded contracts proved
// INTENT (argv tokens and `keep_vars: true`) and then a pinned inheritance
// SOURCE the production API rejects outright. Both described mechanisms that
// could not deliver a 12-binding Worker.
//
// What is proved here is the SHAPE OF THE RESULT: the binding set the upload
// will produce, as a value-free projection of names and classes. This process
// is never handed a value, so no rule below can be written in terms of one.

const explicitViolations = [];
let uploadSpecificationDigest = null;
let projectedBindingCount = null;
let projectedInheritRecordCount = null;

if (preuploadOnly) {
  const projectionPath = arg("--upload-binding-projection");
  const suppliedDigest = arg("--upload-specification-digest");
  let projection = null;

  if (!projectionPath) {
    explicitViolations.push({
      code: "specification_malformed",
      binding: "(upload projection)",
      detail:
        "--upload-binding-projection is required. It is the VALUE-FREE description of the binding " +
        "set the upload will produce, generated per release by the upload wrapper. A missing " +
        "projection is a STOP, never a fallback to the generated configuration.",
    });
  } else {
    const projectionAbsolute = resolve(REPO, projectionPath);
    if (!existsSync(projectionAbsolute)) {
      explicitViolations.push({
        code: "specification_malformed",
        binding: "(upload projection)",
        detail: `no upload binding projection at ${projectionPath}.`,
      });
    } else {
      try {
        projection = JSON.parse(readFileSync(projectionAbsolute, "utf8"));
      } catch {
        explicitViolations.push({
          code: "specification_malformed",
          binding: "(upload projection)",
          detail: "the upload binding projection is not valid JSON. The document is not echoed.",
        });
      }
    }
  }

  if (projection !== null) {
    const explicitVerdict = verifyFinalBindingProjection({
      projection,
      liveBindingNames: live.map((binding) => binding.name),
    });
    for (const violation of explicitVerdict.violations) {
      explicitViolations.push({
        code: violation.code,
        binding: "(explicit bindings)",
        detail: violation.detail,
      });
    }
    projectedBindingCount = explicitVerdict.bindingCount;
    projectedInheritRecordCount =
      typeof projection.inheritRecordCount === "number" ? projection.inheritRecordCount : null;

    // The digest is an OPAQUE INTEGRITY TOKEN, carried through rather than
    // recomputed. This process cannot recompute it: it never sees the
    // value-carrying document, and the salt lives only in the wrapper. The
    // wrapper re-proves it — and re-parses the real bytes against the full
    // contract — immediately before spawning Wrangler.
    if (explicitVerdict.ok) {
      if (typeof suppliedDigest === "string" && /^[a-f0-9]{64}$/.test(suppliedDigest)) {
        uploadSpecificationDigest = suppliedDigest;
      } else {
        explicitViolations.push({
          code: "specification_malformed",
          binding: "(upload projection)",
          detail:
            "--upload-specification-digest is missing or is not a 64-character hex digest. Without " +
            "it there is nothing for the upload wrapper to re-verify against.",
        });
      }
    }
  }

  for (const violation of explicitViolations) log(`  ${violation.code}: ${violation.detail}`);
}

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
if (preuploadOnly) {
  log(`explicit bindings  : ${explicitViolations.length === 0 ? "OK" : "REFUSED"}`);
  log(`inherit records    : ${projectedInheritRecordCount ?? "(unknown)"}`);
  log(`projected bindings : ${projectedBindingCount ?? "(unknown)"}`);
  log(`upload spec digest : ${uploadSpecificationDigest ?? "(none)"}`);
}

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
  explicitViolations.length === 0 &&
  // A PREUPLOAD pass REQUIRES a recorded digest. Without one there is nothing
  // for the upload wrapper to re-verify against, so "verified" and "consumed"
  // could diverge — which is the whole class of failure being closed.
  (!preuploadOnly || uploadSpecificationDigest !== null) &&
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
  // Explicit bindings: the SHAPE of the binding set the upload will produce.
  // No binding value appears here — only names, classes, counts and an opaque
  // salted digest.
  explicitBindingsOk: preuploadOnly ? explicitViolations.length === 0 : null,
  projectedBindingCount,
  projectedInheritRecordCount,
  expectedFinalBindingCount: preuploadOnly ? EXPECTED_FINAL_BINDING_COUNT : null,
  uploadSpecificationSha256: uploadSpecificationDigest,
  uploadSpecificationDigestIsSalted: preuploadOnly ? true : null,
  violations: [
    ...schemaViolations,
    ...versionViolations,
    ...explicitViolations,
    ...verdict.violations,
  ],
  verdict: ok
    ? preuploadOnly
      ? PREUPLOAD_EXPLICIT_BINDINGS_MARKER
      : "BINDINGS_PRESERVED"
    : "STOP",
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
    ? `PASS (${PREUPLOAD_EXPLICIT_BINDINGS_MARKER}) — the live snapshot carries the full ` +
        `${EXPECTED_FINAL_BINDING_COUNT}-binding contract; the upload declares both ` +
        "deployment-managed variables EXPLICITLY as plain_text, carries ZERO inherit records and " +
        "no vars block, keeps all ten bindings that survive without explicit records, duplicates " +
        `no name, and projects exactly ${projectedBindingCount} bindings. No value was read by ` +
        `this process. The upload must consume the specification whose salted digest is ` +
        `${uploadSpecificationDigest}.`
    : "PASS — every live binding is preserved, both snapshots are pinned to the exact previous " +
        "and upload-returned Worker UUIDs, the fingerprints are EQUAL and the keep-vars contract " +
        "holds.",
);
