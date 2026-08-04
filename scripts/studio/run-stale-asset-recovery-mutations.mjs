#!/usr/bin/env node
/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — mutation controls.
 *
 * Twenty-one edits to REAL source and REAL documentation, each of which must make
 * a NAMED assertion fail. A process that could not start, a run that collected
 * no tests, or a failure for some other reason is rejected as evidence rather
 * than counted as a detection — that classification lives in
 * `mutation-runner-core.mjs` and is itself covered by
 * `run-mutation-runner-selftest.mjs`.
 *
 * Every file is restored from its ORIGINAL bytes in a `finally`, and a final
 * byte comparison proves the working tree is exactly as it started.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MutationRunnerError,
  classifyRun,
  replaceExactlyOnce,
  restoreAll,
} from "./mutation-runner-core.mjs";

const REPO = process.cwd();

const CONTRACT = resolve(REPO, "src/lib/stale-asset/stale-asset-contract.ts");
const RECOVERY = resolve(REPO, "src/lib/stale-asset/stale-asset-recovery.ts");
const RECOVERY_CONTRACT = resolve(REPO, "src/lib/stale-asset/stale-asset-recovery-contract.ts");
const CAPTURE = resolve(REPO, "src/lib/stale-asset/global-capture.ts");
const ROOT_ROUTE = resolve(REPO, "src/routes/__root.tsx");
const WRANGLER = resolve(REPO, "wrangler.jsonc");
const RUNBOOK = resolve(REPO, "docs/FOREVER_PRODUCTION_RELEASE_RUNBOOK.md");

const CLASSIFIER_TEST = "src/lib/stale-asset/stale-asset-classifier.test.ts";
const RECOVERY_TEST = "src/lib/stale-asset/stale-asset-recovery.test.ts";
const CAPTURE_TEST = "src/lib/stale-asset/global-capture.test.ts";
const BOUNDARY_TEST = "src/lib/stale-asset/root-boundary.test.tsx";
const WRITE_TEST = "src/lib/stale-asset/write-safety.test.ts";
const CONFIG_TEST = "src/lib/stale-asset/worker-config-contract.test.ts";
const RUNBOOK_TEST = "src/lib/stale-asset/release-runbook-contract.test.ts";

const ALL_TESTS = [
  CLASSIFIER_TEST,
  RECOVERY_TEST,
  CAPTURE_TEST,
  BOUNDARY_TEST,
  WRITE_TEST,
  CONFIG_TEST,
  RUNBOOK_TEST,
];

const VITEST = resolve(
  REPO,
  "node_modules/.bin",
  process.platform === "win32" ? "vitest.cmd" : "vitest",
);

const originals = new Map(
  [CONTRACT, RECOVERY, RECOVERY_CONTRACT, CAPTURE, ROOT_ROUTE, WRANGLER, RUNBOOK].map((file) => [
    file,
    readFileSync(file),
  ]),
);

function test(files) {
  return spawnSync(VITEST, ["run", ...files], {
    cwd: REPO,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
}

const mutations = [
  {
    name: "classifier accepts any TypeError",
    file: CONTRACT,
    from: '  const message = typeof signal.message === "string" ? signal.message : "";\n',
    to:
      '  const message = typeof signal.message === "string" ? signal.message : "";\n' +
      '  if (lower(message).includes("typeerror")) return "stale_dynamic_import";\n',
    tests: [CLASSIFIER_TEST],
    reason: /refuses a generic TypeError with no asset evidence/,
  },
  {
    name: "external URL accepted",
    file: CONTRACT,
    from: "  if (url.origin !== origin) return null;\n",
    to: "",
    tests: [CLASSIFIER_TEST],
    reason: /refuses an external URL — the same-origin requirement/,
  },
  {
    name: "hashed asset carrying a query is accepted",
    file: CONTRACT,
    from: '  if (url.search !== "" || url.hash !== "") return null;\n',
    to: "",
    tests: [CLASSIFIER_TEST],
    reason: /refuses a hashed asset path carrying a query or a fragment/,
  },
  {
    name: "reload guard removed",
    file: RECOVERY,
    from:
      "  const denial = ledgerBlocksTransition(ledger, ownBuildId, activeBuildId);\n" +
      "  if (denial) return refuse(denial);",
    to: "  void ledgerBlocksTransition;",
    tests: [RECOVERY_TEST],
    reason: /REFUSES a second reload for the same transition and shows the recovery screen/,
  },
  {
    name: "second failure reloads again",
    file: RECOVERY_CONTRACT,
    from:
      "  if (spentOnThisTransition >= STALE_ASSET_RECOVERY_MAX_TRANSITION_ATTEMPTS) {\n" +
      '    return "attempt_already_used";\n' +
      "  }",
    to: "  void spentOnThisTransition;",
    tests: [RECOVERY_TEST],
    reason: /never loops: N further failures produce N refusals and zero reloads/,
  },
  /**
   * ADVERSARIAL CONTROL 1 (independent-review P1-1) — transition history
   * replaced by one slot. This is the EXACT reviewed defect: a ledger that
   * keeps only the most recent attempt lets an alternating origin reload
   * without bound.
   */
  {
    name: "transition history replaced by one slot",
    file: RECOVERY_CONTRACT,
    from:
      "  const history = [...ledger.history, { from: attempt.from, to: attempt.to, at: attempt.at }].slice(\n" +
      "    -STALE_ASSET_RECOVERY_MAX_HISTORY,\n" +
      "  );",
    to: "  const history = [{ from: attempt.from, to: attempt.to, at: attempt.at }];",
    tests: [RECOVERY_TEST],
    reason: /A → B → A → B repeated 20 times issues at most two automatic reloads/,
  },
  /**
   * ADVERSARIAL CONTROL 2 (independent-review P1-2) — non-Studio navigation
   * clears history. Restores the reviewed defect where the recovery screen's
   * own "Go to site" control erased the guard it exists to enforce.
   */
  {
    name: "non-Studio navigation clears the attempted-transition history",
    file: RECOVERY_CONTRACT,
    from:
      "  if (!pending) return { accepted: false, refusal: \"no_pending_recovery\" };\n" +
      "  if (attestation.buildId !== pending.to) {",
    to:
      "  if (!pending) return { accepted: true };\n" +
      "  if (false && attestation.buildId !== pending.to) {",
    tests: [RECOVERY_TEST],
    reason: /the recovery screen's own 'Go to site' does NOT clear anything/,
  },
  /**
   * ADVERSARIAL CONTROL 9 (independent-review P2-1) — outcome B falls through
   * to the generic root boundary.
   */
  {
    name: "outcome B falls through to the generic boundary",
    file: ROOT_ROUTE,
    from:
      "  const staleAsset = stateRendersRecoveryScreen(recoveryState) || isConfirmedStaleAssetError(error);",
    to: "  const staleAsset = isConfirmedStaleAssetError(error);",
    tests: [BOUNDARY_TEST],
    reason:
      /B — a confirmed stale failure renders the specific screen from the MACHINE, not the message/,
  },
  {
    name: "Auth storage cleared during recovery",
    file: RECOVERY,
    from: '  setState("recovering");\n  environment.reload(',
    to: '  setState("recovering");\n  localStorage.clear();\n  environment.reload(',
    tests: [RECOVERY_TEST],
    reason: /never touches the browser's real localStorage, where the Auth session lives/,
  },
  {
    name: "ordinary errors trigger reload",
    file: RECOVERY,
    from: '  if (!verdictIsStale(verdict)) return { verdict, outcome: "not_stale" };',
    to: "  void verdictIsStale;",
    tests: [RECOVERY_TEST],
    reason: /non-stale errors never reload/,
  },
  {
    name: "recovery resubmits a mutation",
    file: RECOVERY,
    from: '  setState("recovering");\n  environment.reload(',
    to:
      '  setState("recovering");\n' +
      '  await fetch("/_serverFn/studioProcessJob", { method: "POST" });\n' +
      "  environment.reload(",
    tests: [WRITE_TEST],
    reason: /the recovery machine contains no mutation, retry, upload or publication call/,
  },
  {
    name: "root error exposes the raw message",
    file: ROOT_ROUTE,
    from:
      '        <p className="mt-2 text-sm text-muted-foreground">\n' +
      "          Something went wrong on our end. You can try refreshing or head back home.\n" +
      "        </p>",
    to: '        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>',
    tests: [BOUNDARY_TEST],
    reason: /renders no raw exception in either outcome/,
  },
  {
    name: "global listener registered twice",
    file: CAPTURE,
    from:
      "export function installStaleAssetCapture(): void {\n" +
      "  if (installed) return;\n" +
      '  if (typeof window === "undefined") return;',
    to:
      "export function installStaleAssetCapture(): void {\n" +
      '  if (typeof window === "undefined") return;',
    tests: [CAPTURE_TEST],
    reason: /does not duplicate listeners when installed again/,
  },
  {
    name: "observability removed",
    file: WRANGLER,
    from: '  "observability": {\n    "enabled": true,\n    "head_sampling_rate": 1,\n  },\n',
    to: "",
    tests: [CONFIG_TEST],
    reason: /enables Workers Logs with full invocation sampling/,
  },
  {
    name: "generated Worker loses an existing binding",
    file: WRANGLER,
    from:
      "    {\n" +
      '      "binding": "R2_PROJECT_ARCHIVES",\n' +
      '      "bucket_name": "forever-project-archives",\n' +
      "    },\n",
    to: "",
    tests: [CONFIG_TEST],
    reason: /keeps all three R2 bucket bindings, bound to the production buckets/,
  },
  {
    name: "runbook restores 5% → 25% → 100% without version affinity",
    file: RUNBOOK,
    from:
      "> **Until true version affinity exists, a percentage rollout is PROHIBITED for\n" +
      "> any version that carries a different content-hashed asset set.**",
    to: "> Roll the new version out gradually: 5% → 25% → 100%.",
    tests: [RUNBOOK_TEST],
    reason: /states the prohibition explicitly/,
  },
  {
    name: "first-bootstrap Owner hold omitted",
    file: RUNBOOK,
    from:
      "7. **Obtain an explicit, short Owner Studio hold.** Required for the first\n" +
      "   bootstrap release — see §4. The Owner is told the window and told to take no\n" +
      "   Studio action during it.",
    to: "7. **Proceed.** No Owner hold is required.",
    tests: [RUNBOOK_TEST],
    reason: /keeps the full corrected sequence, in order/,
  },
];

let failed = false;
let detected = 0;

try {
  // The harness itself is validated before it is used as evidence.
  const selfTest = spawnSync(
    process.execPath,
    [resolve(REPO, "scripts/studio/run-mutation-runner-selftest.mjs")],
    { cwd: REPO, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } },
  );
  process.stdout.write(selfTest.stdout ?? "");
  if (selfTest.status !== 0) {
    throw new MutationRunnerError(
      `mutation-runner self-test failed\n${selfTest.stdout}\n${selfTest.stderr}`,
    );
  }

  // The unmutated baseline must pass, or no later result means anything.
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

  for (const mutation of mutations) {
    try {
      replaceExactlyOnce(mutation.file, mutation.from, mutation.to);
      const verdict = classifyRun(test(mutation.tests), mutation.reason);
      if (verdict.verdict !== "detected") {
        throw new MutationRunnerError(`${mutation.name}: ${verdict.verdict} — ${verdict.detail}`);
      }
      detected += 1;
      console.log(`[stale-asset-mutation] DETECTED: ${mutation.name}`);
    } finally {
      writeFileSync(mutation.file, originals.get(mutation.file));
    }
  }
} catch (error) {
  failed = true;
  console.error(`[stale-asset-mutation] FAIL\n${error.message}`);
} finally {
  const mismatched = restoreAll(originals);
  for (const file of mismatched) {
    failed = true;
    console.error(`[stale-asset-mutation] restore mismatch: ${file}`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(
    `[stale-asset-mutation] PASS: ${detected}/${mutations.length} detected; source restored byte-for-byte`,
  );
}
