#!/usr/bin/env node
/**
 * FOREVER-WRANGLER-KEEP-VARS-CORRECTION-001 — mutation controls.
 *
 * Eight edits to REAL source, REAL configuration and REAL documentation, each
 * of which must make a NAMED assertion fail. A guard that has never been seen
 * to fail is not a guard, and this correction exists precisely because a
 * safety property was believed rather than measured.
 *
 * The eight are the eight ways this correction could be silently undone:
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
 * A process that could not start, a run that collected no tests, or a failure
 * for some other reason is REJECTED as evidence rather than counted as a
 * detection — that classification lives in `mutation-runner-core.mjs`.
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
} from "../studio/mutation-runner-core.mjs";

const REPO = process.cwd();

const WRANGLER = resolve(REPO, "wrangler.jsonc");
const RUNBOOK = resolve(REPO, "docs/FOREVER_PRODUCTION_RELEASE_RUNBOOK.md");
const CONTRACT = resolve(REPO, "src/lib/stale-asset/worker-variable-preservation.ts");
const PREFLIGHT = resolve(REPO, "scripts/release/verify-binding-preservation.mjs");

const PRESERVATION_TEST = "src/lib/stale-asset/worker-variable-preservation.test.ts";
const CONFIG_TEST = "src/lib/stale-asset/worker-config-contract.test.ts";
const RUNBOOK_TEST = "src/lib/stale-asset/release-runbook-contract.test.ts";
const PREFLIGHT_TEST = "src/lib/stale-asset/release-binding-preflight.test.ts";

const ALL_TESTS = [PRESERVATION_TEST, CONFIG_TEST, RUNBOOK_TEST, PREFLIGHT_TEST];

const VITEST = resolve(
  REPO,
  "node_modules/.bin",
  process.platform === "win32" ? "vitest.cmd" : "vitest",
);

const originals = new Map(
  [WRANGLER, RUNBOOK, CONTRACT, PREFLIGHT].map((file) => [file, readFileSync(file)]),
);

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
    tests: [PRESERVATION_TEST, RUNBOOK_TEST],
    reason: /wrangler versions upload --keep-vars|instruction without --keep-vars/,
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
    from: "/** The production candidate upload command, in full. */",
    to:
      "/** A committed production value. This is the value-leak control. */\n" +
      'export const LEAKED_SUPABASE_ORIGIN = "https://abtvsrcnfwlbawvrjeed.supabase.co";\n\n' +
      "/** The production candidate upload command, in full. */",
    tests: [PRESERVATION_TEST],
    reason: /commits no value for either deployment-managed variable|supabase\.co/,
  },
];

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
    try {
      replaceExactlyOnce(mutation.file, mutation.from, mutation.to);
      if (mutation.rebuild) rebuildGeneratedConfig();
      const verdict = classifyRun(test(mutation.tests), mutation.reason);
      if (verdict.verdict !== "detected") {
        throw new MutationRunnerError(`${mutation.name}: ${verdict.verdict} — ${verdict.detail}`);
      }
      detected += 1;
      console.log(`[keep-vars-mutation] DETECTED: ${mutation.name}`);
    } finally {
      writeFileSync(mutation.file, originals.get(mutation.file));
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
