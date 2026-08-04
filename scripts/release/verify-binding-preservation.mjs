#!/usr/bin/env node
/**
 * FOREVER-WRANGLER-KEEP-VARS-CORRECTION-001 — fail-closed release preflight.
 *
 * Run BEFORE any future candidate is promoted. It answers one question:
 *
 *   does the candidate carry every binding the live Worker carries?
 *
 * Candidate `ae4cae19` did not. It lost SUPABASE_URL and
 * STUDIO_STORAGE_WRITE_PROVIDER because Wrangler deletes deployment-managed
 * vars unless the upload passes `--keep-vars`, and it returned HTTP 500 on its
 * preview. It was caught at 0% and no traffic moved. This script makes that
 * check mechanical instead of remembered.
 *
 * THIS SCRIPT CONTACTS NOTHING. It reads two sanitized metadata files captured
 * by an authorized release task plus the local generated deploy configuration.
 * It performs no network call, reads no credential, and holds no production
 * access of its own. That is deliberate: the correction task that introduced it
 * had no production authorization, and the script must be runnable — and
 * testable — without any.
 *
 * SECRET VALUES ARE NEVER READ, PRINTED OR PERSISTED. The metadata format is
 * name plus class only. A value appearing in an input file is itself a STOP:
 * see `refuseIfValued`.
 *
 * USAGE
 *   node scripts/release/verify-binding-preservation.mjs \
 *     --live <live-bindings.json> --candidate <candidate-bindings.json> \
 *     [--generated .output/server/wrangler.json] \
 *     [--command "wrangler versions upload --keep-vars ..."] \
 *     [--json <report-out.json>]
 *
 * INPUT SHAPE (both files)
 *   { "bindings": [ { "name": "SUPABASE_URL", "type": "plain_text" }, ... ] }
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

const {
  DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS,
  DEPLOYMENT_MANAGED_SECRET_BINDINGS,
  EXPECTED_PRODUCTION_BINDING_COUNT,
  KEEP_VARS_FLAG,
  PRODUCTION_VERSION_UPLOAD_COMMAND,
  verifyBindingPreservation,
  verifyKeepVarsContract,
} = contract;

const log = (message) => process.stdout.write(`[release-preflight] ${message}\n`);

function fail(message) {
  process.stderr.write(`[release-preflight] STOP: ${message}\n`);
  process.exitCode = 1;
  return null;
}

function arg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * A binding descriptor may carry a NAME and a CLASS and nothing else.
 *
 * Rejecting any extra key is what keeps a value from ever reaching this
 * script's inputs, its output, or an evidence file — including by accident,
 * when a future capture script starts recording more than it should.
 */
const ALLOWED_KEYS = new Set(["name", "type"]);
const ALLOWED_TYPES = new Set(["assets", "r2_bucket", "plain_text", "secret_text"]);

function refuseIfValued(bindings, label) {
  for (const binding of bindings) {
    const extra = Object.keys(binding).filter((key) => !ALLOWED_KEYS.has(key));
    if (extra.length > 0) {
      return `${label} carries disallowed key(s) ${extra.join(", ")} on "${binding.name}". This preflight accepts NAME and CLASS only — a captured value must never reach it.`;
    }
    if (typeof binding.name !== "string" || binding.name.length === 0) {
      return `${label} contains a binding with no name.`;
    }
    if (!ALLOWED_TYPES.has(binding.type)) {
      return `${label} binding "${binding.name}" has unknown class "${binding.type}".`;
    }
  }
  return null;
}

function loadBindings(path, label) {
  if (!path) return fail(`${label} metadata path not supplied.`);
  const absolute = resolve(REPO, path);
  if (!existsSync(absolute)) return fail(`${label} metadata not found at ${path}.`);

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    return fail(`${label} metadata is not valid JSON: ${error.message}`);
  }

  const bindings = parsed?.bindings;
  if (!Array.isArray(bindings) || bindings.length === 0) {
    return fail(`${label} metadata has no bindings array — an empty capture is never a pass.`);
  }

  const valued = refuseIfValued(bindings, label);
  if (valued) return fail(valued);

  return bindings.map((binding) => ({ name: binding.name, type: binding.type }));
}

const live = loadBindings(arg("--live"), "live");
const candidate = loadBindings(arg("--candidate"), "candidate");
if (!live || !candidate) {
  log("refusing to report a verdict on untrusted or missing input.");
  process.exit(1);
}

// ---- the keep-vars contract, checked against what would actually be run -----

const generatedPath = arg("--generated") ?? ".output/server/wrangler.json";
const generatedAbsolute = resolve(REPO, generatedPath);
let generatedConfig = null;
if (existsSync(generatedAbsolute)) {
  try {
    generatedConfig = JSON.parse(readFileSync(generatedAbsolute, "utf8"));
  } catch (error) {
    fail(`generated deploy configuration is not valid JSON: ${error.message}`);
  }
} else {
  fail(
    `generated deploy configuration not found at ${generatedPath}. Run \`npm run build\` first — a missing artefact is a STOP, never a skip.`,
  );
}

const uploadCommand = arg("--command") ?? PRODUCTION_VERSION_UPLOAD_COMMAND;
const keepVars = generatedConfig
  ? verifyKeepVarsContract({ generatedConfig, uploadCommand })
  : { ok: false, reasons: ["generated deploy configuration unavailable"] };

// ---- the binding comparison ------------------------------------------------

const verdict = verifyBindingPreservation(live, candidate);

log(`live bindings      : ${verdict.liveBindingCount}`);
log(`candidate bindings : ${verdict.candidateBindingCount}`);
log(`expected total     : ${EXPECTED_PRODUCTION_BINDING_COUNT}`);
log(`fingerprints equal : ${verdict.liveFingerprint === verdict.candidateFingerprint}`);
log(`keep-vars contract : ${keepVars.ok ? "OK" : "VIOLATED"}`);

for (const reason of keepVars.reasons) log(`  keep-vars: ${reason}`);
for (const violation of verdict.violations) {
  log(`  ${violation.code}: ${violation.binding} — ${violation.detail}`);
}

// The one false negative this script exists to refuse.
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

const ok = verdict.ok && keepVars.ok;

const report = {
  task: "FOREVER-WRANGLER-KEEP-VARS-CORRECTION-001",
  contactedProduction: false,
  secretValuesRead: 0,
  liveBindingCount: verdict.liveBindingCount,
  candidateBindingCount: verdict.candidateBindingCount,
  expectedBindingCount: EXPECTED_PRODUCTION_BINDING_COUNT,
  fingerprintsEqual: verdict.liveFingerprint === verdict.candidateFingerprint,
  keepVarsContractOk: keepVars.ok,
  keepVarsReasons: keepVars.reasons,
  uploadCommandCarriesFlag: uploadCommand.includes(KEEP_VARS_FLAG),
  violations: verdict.violations,
  verdict: ok ? "BINDINGS_PRESERVED" : "STOP",
};

const jsonOut = arg("--json");
if (jsonOut) {
  writeFileSync(resolve(REPO, jsonOut), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  log(`report written to ${jsonOut}`);
}

if (!ok) {
  process.stderr.write(
    "[release-preflight] STOP — candidate REJECTED. A candidate with fewer bindings than the live " +
      "Worker is rejected even while it holds 0% of traffic. Do not move traffic.\n",
  );
  process.exit(1);
}

log("PASS — every live binding is preserved and the keep-vars contract holds.");
