#!/usr/bin/env node
/**
 * FOREVER-WRANGLER-KEEP-VARS-CORRECTION-001 — mutation controls.
 * Extended by FOREVER-PR138-MERGE-BLOCKER-CORRECTION-002 from 8 to 20, then by
 * FOREVER-PR138-WORKER-VERSION-PINNING-CORRECTION-004 from 20 to 28.
 *
 * Twenty-eight edits to REAL source, configuration, tests and documentation, each
 * of which must make a NAMED assertion fail. A guard that has never been seen
 * to fail is not a guard, and this correction exists precisely because a safety
 * property was believed rather than measured — twice.
 *
 * THE ORIGINAL EIGHT — the eight ways the first correction could be undone:
 *
 *   1. remove keep_vars from the canonical config;
 *   2. remove --keep-vars from the documented versions upload;
 *   3. add an empty vars block;
 *   4. declare only ONE of the two required plain-text bindings;
 *   5. treat preserved secrets as proof that plain-text vars survived;
 *   6. allow a candidate carrying fewer bindings than live;
 *   7. expose SUPABASE_URL to a client bundle;
 *   8. write a real production variable value into repository source.
 *
 * THE TWELVE THE PR138 REVIEW REQUIRED — the ways the SECOND correction could
 * be undone. Every one of these is a real defect that a review found, or the
 * exact shape of one:
 *
 *   9.  replace the structured argv with a shell string;
 *   10. accept `--keep-vars=false`;
 *   11. accept a flag after a `--` terminator;
 *   12. change the generated-config path;
 *   13. bypass the capture schema and accept hand-prepared JSON;
 *   14. persist the raw Cloudflare response;
 *   15. retain a plain_text `text` value in the sanitized output;
 *   16. allow an unknown Cloudflare binding type;
 *   17. accept an unknown top-level snapshot key;
 *   18. accept duplicate binding names;
 *   19. remove fingerprint equality from the PASS condition;
 *   20. permit one added and one removed binding at equal count.
 *
 * THE EIGHT VERSION-PINNING CONTROLS:
 *
 *   21. remove the live snapshot UUID comparison;
 *   22. remove the candidate snapshot UUID comparison;
 *   23. allow candidate Worker UUID to equal previous;
 *   24. accept a manually supplied candidate UUID without the upload receipt;
 *   25. reuse the live snapshot as the candidate;
 *   26. permit preview acceptance before postupload identity PASS;
 *   27. introduce a PATH-resolved Wrangler fallback;
 *   28. make fixture comparison CRLF-sensitive.
 *
 * A process that could not start, a run that collected no tests, or a failure
 * for some other reason is REJECTED as evidence rather than counted as a
 * detection — that classification lives in `mutation-runner-core.mjs`.
 *
 * EVERY MUTATION IS PROVED TO HAVE LANDED. `replaceExactlyOnce` refuses unless
 * the pattern occurs exactly once, and the bytes are compared before and after,
 * so "the tests failed" can never be a mutation that was never applied.
 *
 * Every file is restored from its ORIGINAL bytes in a `finally`, and a final
 * byte comparison proves the working tree is exactly as it started.
 *
 * Nothing here deploys, uploads, reads a credential or touches production.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MutationRunnerError,
  classifyRun,
  replaceExactlyOnce,
  restoreAll,
  sha256,
} from "../studio/mutation-runner-core.mjs";

const REPO = process.cwd();

const WRANGLER = resolve(REPO, "wrangler.jsonc");
const RUNBOOK = resolve(REPO, "docs/FOREVER_PRODUCTION_RELEASE_RUNBOOK.md");
const CONTRACT = resolve(REPO, "src/lib/stale-asset/worker-variable-preservation.ts");
const CAPTURE = resolve(REPO, "src/lib/stale-asset/worker-binding-capture.ts");
const PREFLIGHT = resolve(REPO, "scripts/release/verify-binding-preservation.mjs");
const CAPTURE_CLI = resolve(REPO, "scripts/release/capture-worker-version-bindings.mjs");
const UPLOAD_WRAPPER = resolve(REPO, "scripts/release/upload-worker-version.mjs");
const WRANGLER_GATE = resolve(REPO, "scripts/release/wrangler-version-gate.mjs");
const RELEASE_IDENTITY = resolve(REPO, "src/lib/stale-asset/worker-release-identity.ts");
const CAPTURE_TEST_SOURCE = resolve(REPO, "src/lib/stale-asset/worker-binding-capture.test.ts");

const TOUCHED = [
  WRANGLER,
  RUNBOOK,
  CONTRACT,
  CAPTURE,
  PREFLIGHT,
  CAPTURE_CLI,
  UPLOAD_WRAPPER,
  WRANGLER_GATE,
  RELEASE_IDENTITY,
  CAPTURE_TEST_SOURCE,
];

const PRESERVATION_TEST = "src/lib/stale-asset/worker-variable-preservation.test.ts";
const CONFIG_TEST = "src/lib/stale-asset/worker-config-contract.test.ts";
const RUNBOOK_TEST = "src/lib/stale-asset/release-runbook-contract.test.ts";
const PREFLIGHT_TEST = "src/lib/stale-asset/release-binding-preflight.test.ts";
const UPLOAD_TEST = "src/lib/stale-asset/worker-upload-command.test.ts";
const CAPTURE_TEST = "src/lib/stale-asset/worker-binding-capture.test.ts";
const RELEASE_IDENTITY_TEST = "src/lib/stale-asset/release-identity-separation.test.ts";

const ALL_TESTS = [
  PRESERVATION_TEST,
  CONFIG_TEST,
  RUNBOOK_TEST,
  PREFLIGHT_TEST,
  UPLOAD_TEST,
  CAPTURE_TEST,
  RELEASE_IDENTITY_TEST,
];

const VITEST = resolve(
  REPO,
  "node_modules/.bin",
  process.platform === "win32" ? "vitest.cmd" : "vitest",
);

const originals = new Map(TOUCHED.map((file) => [file, readFileSync(file)]));

function test(files) {
  return spawnSync(VITEST, ["run", ...files], {
    cwd: REPO,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
}

/**
 * Rebuilds the generated deploy config from the (possibly mutated)
 * `wrangler.jsonc`.
 *
 * Mutations 1 and 3 change what actually deploys, and the assertions that
 * catch them read `.output/server/wrangler.json`. Asserting only against the
 * JSONC source would leave the generated artefact — the file Wrangler is
 * handed — unmeasured, which is the same class of gap this task is correcting.
 */
function rebuildGeneratedConfig() {
  const result = spawnSync(process.execPath, [resolve(REPO, "scripts/build/build-forever.mjs")], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  if (result.status !== 0) {
    throw new MutationRunnerError(
      `rebuild failed while preparing a mutation:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

const mutations = [
  {
    name: "1. keep_vars removed from the canonical configuration",
    file: WRANGLER,
    from: '  "keep_vars": true,\n',
    to: "",
    rebuild: true,
    tests: [PRESERVATION_TEST, CONFIG_TEST],
    reason: /keep_vars|sets keep_vars: true|retains keep_vars=true/,
  },
  {
    name: "2. --keep-vars removed from the documented versions upload",
    file: RUNBOOK,
    from: "   wrangler versions upload --keep-vars --config .output/server/wrangler.json\n",
    to: "   wrangler versions upload --config .output/server/wrangler.json\n",
    tests: [PRESERVATION_TEST, RUNBOOK_TEST, UPLOAD_TEST],
    reason:
      /wrangler versions upload --keep-vars|instruction without --keep-vars|byte-for-byte in the runbook/,
  },
  {
    name: "3. an empty vars block is added to the canonical configuration",
    file: WRANGLER,
    from: '  "keep_vars": true,\n',
    to: '  "keep_vars": true,\n  "vars": {},\n',
    rebuild: true,
    tests: [PRESERVATION_TEST, CONFIG_TEST],
    reason: /vars|declares NO vars block|declares a vars block/,
  },
  {
    name: "4. only ONE of the two required plain-text bindings is declared",
    file: CONTRACT,
    from:
      "export const DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS = [\n" +
      '  "STUDIO_STORAGE_WRITE_PROVIDER",\n' +
      '  "SUPABASE_URL",\n' +
      "] as const;",
    to:
      "export const DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS = [\n" +
      '  "STUDIO_STORAGE_WRITE_PROVIDER",\n' +
      "] as const;",
    tests: [PRESERVATION_TEST],
    reason: /names the two plain-text variables|expects exactly twelve bindings|SUPABASE_URL/,
  },
  {
    name: "5. surviving secrets are treated as proof that plain-text vars survived",
    file: CONTRACT,
    from:
      "  for (const name of DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS) {\n" +
      "    if (!candidateByName.has(name)) {\n",
    to:
      "  const everySecretPresent = DEPLOYMENT_MANAGED_SECRET_BINDINGS.every((secret) =>\n" +
      "    candidateByName.has(secret),\n" +
      "  );\n" +
      "  for (const name of DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS) {\n" +
      "    if (!everySecretPresent && !candidateByName.has(name)) {\n",
    tests: [PRESERVATION_TEST, PREFLIGHT_TEST],
    reason:
      /REFUSES to treat surviving secrets as proof|REPRODUCES the ae4cae19 failure|plain_text_binding_missing/,
  },
  {
    name: "6. a candidate with fewer bindings than live is allowed",
    file: CONTRACT,
    from: "  if (candidate.length < live.length) {",
    to: "  if (false && candidate.length < live.length) {",
    tests: [PRESERVATION_TEST],
    reason: /binding_count_regressed|REJECTS a candidate with fewer bindings|0%/,
  },
  {
    name: "7. SUPABASE_URL is given a client-exposed VITE_ form",
    file: CONTRACT,
    from: "/** The exact flag that makes an upload preserve deployment-managed variables. */",
    to:
      "/** A client-exposed alias. This is the boundary violation control. */\n" +
      'export const CLIENT_SUPABASE_URL_VAR = "VITE_SUPABASE_URL";\n\n' +
      "/** The exact flag that makes an upload preserve deployment-managed variables. */",
    tests: [PRESERVATION_TEST],
    reason: /server-only|VITE_|client-exposed variable name/,
  },
  {
    name: "8. a real production variable value is written into repository source",
    file: CONTRACT,
    from: "/** Binding classes a fingerprint distinguishes. Values are never included. */",
    to:
      "/** A committed production value. This is the value-leak control. */\n" +
      'export const LEAKED_SUPABASE_ORIGIN = "https://pr138syntheticcanary.supabase.co";\n\n' +
      "/** Binding classes a fingerprint distinguishes. Values are never included. */",
    tests: [PRESERVATION_TEST],
    reason: /commits no value for either deployment-managed variable|supabase\.co/,
  },

  // ---- PR138 review controls ----------------------------------------------

  {
    name: "9. the structured argv is replaced by a word-split shell string",
    file: CONTRACT,
    from:
      "  // A string is the exact input shape this correction exists to remove.\n" +
      '  if (typeof spec === "string") {\n',
    to:
      "  // MUTATION: a shell string is word-split and accepted.\n" +
      '  if (typeof spec === "string") {\n' +
      '    const parts = spec.split(" ");\n' +
      "    return verifyUploadSpec({ executable: parts[0], args: parts.slice(1) });\n" +
      "  }\n" +
      "  if (false) {\n",
    tests: [UPLOAD_TEST, PRESERVATION_TEST],
    reason: /spec_malformed|shell command STRING/,
  },
  {
    name: "10. --keep-vars=false is accepted",
    file: CONTRACT,
    from: '    (token) => token !== KEEP_VARS_FLAG && token.includes("keep-vars"),',
    to: '    (token) => false && token !== KEEP_VARS_FLAG && token.includes("keep-vars"),',
    tests: [UPLOAD_TEST],
    reason: /keep_vars_malformed/,
  },
  {
    name: "11. a flag after a `--` terminator is accepted",
    file: CONTRACT,
    from: '  if (argv.includes("--")) {',
    to: '  if (false && argv.includes("--")) {',
    tests: [UPLOAD_TEST],
    reason: /argument_terminator_present/,
  },
  {
    name: "12. the generated-config path is changed",
    file: CONTRACT,
    from: 'export const GENERATED_WORKER_CONFIG_PATH = ".output/server/wrangler.json";',
    to: 'export const GENERATED_WORKER_CONFIG_PATH = "wrangler.jsonc";',
    tests: [UPLOAD_TEST],
    reason: /generated artefact|SINGLE source of truth|byte-for-byte in the runbook/,
  },
  {
    name: "13. the capture schema is bypassed and hand-prepared JSON is accepted",
    file: PREFLIGHT,
    from: "  const verdict = validateBindingSnapshot(parsed);\n  if (!verdict.ok) {",
    to:
      "  const verdict = validateBindingSnapshot(parsed);\n" +
      "  if (!verdict.ok && Array.isArray(parsed?.bindings)) {\n" +
      "    return {\n" +
      "      schemaVersion: 1,\n" +
      '      workerVersionId: "00000000-0000-4000-8000-000000000000",\n' +
      "      bindings: parsed.bindings,\n" +
      "    };\n" +
      "  }\n" +
      "  if (!verdict.ok) {",
    tests: [PREFLIGHT_TEST],
    reason: /unknown_top_level_key|snapshot_schema_invalid|unknown_descriptor_key/,
  },
  {
    name: "14. the raw Cloudflare response is persisted beside the snapshot",
    file: CAPTURE_CLI,
    from: 'writeFileSync(resolve(REPO, out), serializeBindingSnapshot(normalized.snapshot), "utf8");',
    to:
      'writeFileSync(resolve(REPO, `${out}.raw.json`), JSON.stringify(rawDetail, null, 2), "utf8");\n' +
      'writeFileSync(resolve(REPO, out), serializeBindingSnapshot(normalized.snapshot), "utf8");',
    tests: [CAPTURE_TEST],
    reason: /raw response beside it|writes ONE file|never writes or logs the raw response/,
  },
  {
    name: "15. a plain_text `text` value is retained in the sanitized output",
    edits: [
      {
        file: CAPTURE,
        from: "    sanitized.push({ name, type: CLOUDFLARE_BINDING_TYPE_MAP[type] });",
        to: "    sanitized.push({ name, type: CLOUDFLARE_BINDING_TYPE_MAP[type], text: entry.text });",
      },
      {
        file: CAPTURE,
        from: "      bindings: snapshot.bindings.map((binding) => ({ name: binding.name, type: binding.type })),",
        to: "      bindings: snapshot.bindings.map((binding) => ({ ...binding })),",
      },
    ],
    tests: [CAPTURE_TEST],
    reason: /produces a snapshot without it|keeps only name and type|unknown_descriptor_key/,
  },
  {
    name: "16. an unknown Cloudflare binding type is allowed through",
    file: CAPTURE,
    from: '    if (typeof type !== "string" || !(type in CLOUDFLARE_BINDING_TYPE_MAP)) {',
    to: '    if (typeof type !== "string") {',
    tests: [CAPTURE_TEST],
    reason: /unknown_cloudflare_binding_type|never omits it/,
  },
  {
    name: "17. an unknown top-level snapshot key is accepted",
    file: CAPTURE,
    from: "  const unknown = Object.keys(record).filter((key) => !allowed.has(key));",
    to: "  const unknown = Object.keys(record).filter(() => false);",
    tests: [CAPTURE_TEST, PREFLIGHT_TEST],
    reason: /unknown_top_level_key/,
  },
  {
    name: "18. duplicate binding names are accepted",
    edits: [
      {
        file: CONTRACT,
        from: "      if (seen.has(binding.name) && !reported.has(binding.name)) {",
        to: "      if (false && seen.has(binding.name) && !reported.has(binding.name)) {",
      },
      {
        file: CAPTURE,
        from: "    if (seen.has(descriptor.name)) {",
        to: "    if (false && seen.has(descriptor.name)) {",
      },
    ],
    tests: [PRESERVATION_TEST, PREFLIGHT_TEST, CAPTURE_TEST],
    reason: /duplicate_binding|duplicate_binding_name/,
  },
  {
    name: "19. fingerprint equality is removed from the PASS condition",
    edits: [
      {
        file: CONTRACT,
        from: "  if (liveFingerprint !== candidateFingerprint) {",
        to: "  if (false && liveFingerprint !== candidateFingerprint) {",
      },
      {
        file: PREFLIGHT,
        from: "const FINGERPRINT_EQUALITY_REQUIRED = true;",
        to: "const FINGERPRINT_EQUALITY_REQUIRED = false;",
      },
    ],
    tests: [PRESERVATION_TEST, PREFLIGHT_TEST],
    reason:
      /fingerprint_mismatch|fingerprint INEQUALITY|fingerprintEqualityRequiredForPass|fingerprint equality is part of the pass condition/,
  },
  {
    name: "20. one added and one removed binding are permitted at equal count",
    file: CONTRACT,
    from: "    if (!liveByName.has(binding.name)) {",
    to: "    if (false && !liveByName.has(binding.name)) {",
    tests: [PRESERVATION_TEST, PREFLIGHT_TEST],
    reason: /binding_added|at EQUAL count|EQUAL COUNT/,
  },
  {
    name: "21. the live snapshot UUID comparison is removed",
    file: PREFLIGHT,
    from:
      "        liveWorkerVersionMatches =\n" +
      "          liveSnapshot.workerVersionId === releaseProvenance.previousWorkerVersionId;",
    to: "        liveWorkerVersionMatches = true;",
    tests: [PREFLIGHT_TEST],
    reason: /WRONG_LIVE_UUID_REFUSED|live_worker_version_mismatch/,
  },
  {
    name: "22. the candidate snapshot UUID comparison is removed",
    file: PREFLIGHT,
    from:
      "        candidateWorkerVersionMatches =\n" +
      "          candidateSnapshot.workerVersionId === releaseProvenance.candidateWorkerVersionId;",
    to: "        candidateWorkerVersionMatches = true;",
    tests: [PREFLIGHT_TEST],
    reason: /WRONG_CANDIDATE_UUID_REFUSED|candidate_worker_version_mismatch/,
  },
  {
    name: "23. candidate Worker UUID may equal the previous UUID",
    file: RELEASE_IDENTITY,
    from: "  if (record.candidateWorkerVersionId === record.previousWorkerVersionId) {",
    to: "  if (false && record.candidateWorkerVersionId === record.previousWorkerVersionId) {",
    tests: [RELEASE_IDENTITY_TEST, PREFLIGHT_TEST],
    reason: /candidate_worker_version_not_new|CANDIDATE_NOT_PREVIOUS/,
  },
  {
    name: "24. a manual candidate UUID is accepted without the upload receipt",
    edits: [
      {
        file: CAPTURE_CLI,
        from: "if (authorized && offlineVersionId) {",
        to: "if (false && authorized && offlineVersionId) {",
      },
      {
        file: CAPTURE_CLI,
        from: "let versionId = authorized ? liveVersionId : offlineVersionId;",
        to: "let versionId = authorized ? (liveVersionId ?? offlineVersionId) : offlineVersionId;",
      },
    ],
    tests: [UPLOAD_TEST],
    reason: /CANDIDATE_UUID_NOT_MANUAL/,
  },
  {
    name: "25. the live snapshot file may be reused as the candidate",
    file: PREFLIGHT,
    from: '  if (resolve(REPO, arg("--live")) === resolve(REPO, arg("--candidate"))) {',
    to: '  if (false && resolve(REPO, arg("--live")) === resolve(REPO, arg("--candidate"))) {',
    tests: [PREFLIGHT_TEST],
    reason: /SAME_SNAPSHOT_REFUSED|same_snapshot_input/,
  },
  {
    name: "26. preview acceptance is permitted before postupload identity PASS",
    file: RUNBOOK,
    from:
      "   variables survived; see §2a. Only when step 6 reports both\n" +
      "   `workerVersionIdentityOk: true` and `BINDINGS_PRESERVED` does preview\n" +
      "   acceptance begin.",
    to: "   variables survived; see §2a. Preview acceptance may begin before the postupload PASS.",
    tests: [RUNBOOK_TEST],
    reason: /pins POSTUPLOAD|workerVersionIdentityOk/,
  },
  {
    name: "27. Wrangler resolution falls back to PATH",
    file: WRANGLER_GATE,
    from: "  const chosen = override ? resolve(override) : existsSync(local) ? local : null;",
    to: '  const chosen = override ? resolve(override) : existsSync(local) ? local : "wrangler";',
    tests: [UPLOAD_TEST],
    reason: /NO_PATH_FALLBACK/,
  },
  {
    name: "28. fixture comparison becomes CRLF-sensitive",
    file: CAPTURE_TEST_SOURCE,
    from: 'const canonicalUtf8Lf = (value: string) => value.replace(/\\r\\n/g, "\\n");',
    to: "const canonicalUtf8Lf = (value: string) => value;",
    tests: [CAPTURE_TEST],
    reason: /CRLF_LF_DETERMINISTIC/,
  },
];

/** Normalises the two mutation shapes into one list of edits. */
const editsOf = (mutation) =>
  mutation.edits ?? [{ file: mutation.file, from: mutation.from, to: mutation.to }];

let failed = false;
let detected = 0;

try {
  // The unmutated baseline must pass, or no later result means anything.
  rebuildGeneratedConfig();
  const baseline = test(ALL_TESTS);
  if (baseline.error || typeof baseline.status !== "number") {
    throw new MutationRunnerError(
      `mutation baseline could not be run: ${baseline.error?.message ?? "no exit status"}`,
    );
  }
  if (baseline.status !== 0) {
    throw new MutationRunnerError(
      `mutation baseline failed\n${baseline.stdout}\n${baseline.stderr}`,
    );
  }
  console.log("[keep-vars-mutation] baseline PASSED");

  for (const mutation of mutations) {
    const edits = editsOf(mutation);
    try {
      for (const edit of edits) {
        const before = sha256(readFileSync(edit.file));
        replaceExactlyOnce(edit.file, edit.from, edit.to);
        // PROVE the mutation landed. A "failure" produced by an edit that was
        // never applied is not evidence of anything.
        if (sha256(readFileSync(edit.file)) === before) {
          throw new MutationRunnerError(
            `${mutation.name}: the edit to ${edit.file} did not change the file`,
          );
        }
      }
      if (mutation.rebuild) rebuildGeneratedConfig();
      const verdict = classifyRun(test(mutation.tests), mutation.reason);
      if (verdict.verdict !== "detected") {
        throw new MutationRunnerError(`${mutation.name}: ${verdict.verdict} — ${verdict.detail}`);
      }
      detected += 1;
      console.log(`[keep-vars-mutation] DETECTED: ${mutation.name}`);
    } finally {
      for (const edit of edits) writeFileSync(edit.file, originals.get(edit.file));
      if (mutation.rebuild) rebuildGeneratedConfig();
    }
  }
} catch (error) {
  failed = true;
  console.error(`[keep-vars-mutation] FAIL\n${error.message}`);
} finally {
  const mismatched = restoreAll(originals);
  for (const file of mismatched) {
    failed = true;
    console.error(`[keep-vars-mutation] restore mismatch: ${file}`);
  }
  // The generated config must also end where it started.
  try {
    rebuildGeneratedConfig();
  } catch (error) {
    failed = true;
    console.error(`[keep-vars-mutation] final rebuild failed: ${error.message}`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(
    `[keep-vars-mutation] PASS: ${detected}/${mutations.length} detected; source restored byte-for-byte`,
  );
}
