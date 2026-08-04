#!/usr/bin/env node
/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — mutation controls.
 *
 * Thirty-seven edits to REAL source and REAL documentation, each of which must make
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
const PROJECT_EDITOR = resolve(
  REPO,
  "src/features/forever-studio/components/StudioProjectEditor.tsx",
);
const DASHBOARD = resolve(REPO, "src/features/forever-studio/components/StudioDashboard.tsx");
const BUILD_ID = resolve(REPO, "scripts/build/forever-client-asset-id.ts");
const BUILD_ORCHESTRATOR = resolve(REPO, "scripts/build/build-forever.mjs");
const VITE_CONFIG = resolve(REPO, "vite.config.ts");
const LAZY_LOADER = resolve(REPO, "scripts/build/forever-lazy-route-component.js");
const WORKER_CONFIG_TEST_FILE = resolve(REPO, "src/lib/stale-asset/worker-config-contract.test.ts");
const BROWSER_RUNNER = resolve(
  REPO,
  "scripts/studio/stale-asset-harness/run-browser-scenarios.mjs",
);
const FOCUSED_RUNNER = resolve(REPO, "scripts/studio/run-focused-stale-asset-suite.mjs");
const WORKER_RELEASE = resolve(REPO, "src/lib/stale-asset/worker-release-identity.ts");
const CONTRACT_DOC = resolve(REPO, "docs/FOREVER_STUDIO_STALE_ASSET_RECOVERY.md");

const CLASSIFIER_TEST = "src/lib/stale-asset/stale-asset-classifier.test.ts";
const RECOVERY_TEST = "src/lib/stale-asset/stale-asset-recovery.test.ts";
const CAPTURE_TEST = "src/lib/stale-asset/global-capture.test.ts";
const BOUNDARY_TEST = "src/lib/stale-asset/root-boundary.test.tsx";
const WRITE_TEST = "src/lib/stale-asset/write-safety.test.ts";
const CONFIG_TEST = "src/lib/stale-asset/worker-config-contract.test.ts";
const RUNBOOK_TEST = "src/lib/stale-asset/release-runbook-contract.test.ts";
const WRITE_CONTRACT_TEST = "src/lib/stale-asset/studio-write-contract.test.ts";
const BUILD_IDENTITY_TEST = "src/lib/stale-asset/client-asset-identity.test.ts";
const TANSTACK_TEST = "src/lib/stale-asset/tanstack-reload-ownership.test.ts";
const REPORTING_TEST = "src/lib/stale-asset/acceptance-reporting.test.ts";
const SEPARATION_TEST = "src/lib/stale-asset/release-identity-separation.test.ts";

const ALL_TESTS = [
  CLASSIFIER_TEST,
  RECOVERY_TEST,
  CAPTURE_TEST,
  BOUNDARY_TEST,
  WRITE_TEST,
  CONFIG_TEST,
  RUNBOOK_TEST,
  WRITE_CONTRACT_TEST,
  BUILD_IDENTITY_TEST,
  TANSTACK_TEST,
  REPORTING_TEST,
  SEPARATION_TEST,
];

const VITEST = resolve(
  REPO,
  "node_modules/.bin",
  process.platform === "win32" ? "vitest.cmd" : "vitest",
);

const originals = new Map(
  [
    CONTRACT,
    RECOVERY,
    RECOVERY_CONTRACT,
    CAPTURE,
    ROOT_ROUTE,
    WRANGLER,
    RUNBOOK,
    PROJECT_EDITOR,
    DASHBOARD,
    BUILD_ID,
    BUILD_ORCHESTRATOR,
    VITE_CONFIG,
    LAZY_LOADER,
    WORKER_CONFIG_TEST_FILE,
    BROWSER_RUNNER,
    FOCUSED_RUNNER,
    WORKER_RELEASE,
    CONTRACT_DOC,
  ].map((file) => [file, readFileSync(file)]),
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
      "  const denial = ledgerBlocksTransition(ledger, ownClientAssetId, activeBuildId);\n" +
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
      '  if (!pending) return { accepted: false, refusal: "no_pending_recovery" };\n' +
      "  if (attestation.clientAssetId !== pending.to) {",
    to:
      "  if (!pending) return { accepted: true };\n" +
      "  if (false && attestation.clientAssetId !== pending.to) {",
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
    from: "  const staleAsset = stateRendersRecoveryScreen(recoveryState) || isConfirmedStaleAssetError(error);",
    to: "  const staleAsset = isConfirmedStaleAssetError(error);",
    tests: [BOUNDARY_TEST],
    reason:
      /B — a confirmed stale failure renders the specific screen from the MACHINE, not the message/,
  },
  /**
   * ADVERSARIAL CONTROL 3 (independent-review P1-3) — one of the previously
   * missing mutations bypasses the central write boundary. The AST contract
   * test must catch it; a hand-maintained list could not.
   */
  {
    name: "studioSaveProjectFacts bypasses the central write boundary",
    file: PROJECT_EDITOR,
    from:
      "    mutationFn: () =>\n" +
      '      runStudioWriteAction("project_facts", () =>\n' +
      "        studioSaveProjectFacts({ data: { slug: props.slug, facts: facts ?? {} } }),\n" +
      "      ),",
    to:
      "    mutationFn: () =>\n" +
      "      studioSaveProjectFacts({ data: { slug: props.slug, facts: facts ?? {} } }),",
    tests: [WRITE_CONTRACT_TEST],
    reason: /no mutation is dispatched outside runStudioWriteAction/,
  },
  /**
   * ADVERSARIAL CONTROL 4 (independent-review P1-3) — `studioResumePending`
   * auto-fires after a recovered reload. This is the write that genuinely does
   * re-execute on its own, so the gate is the whole protection.
   */
  {
    name: "studioResumePending auto-fires after a recovered reload",
    file: DASHBOARD,
    from: "    if (!resumeIsSafe) return;\n",
    to: "",
    tests: [WRITE_CONTRACT_TEST],
    reason: /is gated on a resolved READ-ONLY overview/,
  },
  /**
   * ADVERSARIAL CONTROL 5 (independent-review P1-4) — an output-changing input
   * stops changing the identity. Dropping the client runtime graph from the
   * digest reproduces the reviewed defect exactly: two builds that emit fifty
   * different chunks share one identifier.
   */
  {
    name: "output-changing input retains the same build identity",
    file: BUILD_ID,
    from:
      '  if (path === "server/wrangler.json") return true;\n' +
      '  return path === "public" || path.startsWith("public/");',
    to: '  return path === "server/wrangler.json";',
    tests: [BUILD_IDENTITY_TEST],
    reason: /the whole client runtime graph contributes, and nothing under public is excluded/,
  },
  /**
   * ADVERSARIAL CONTROL 6 (independent-review P1-4) — the final-pass identity
   * self-verification is removed, so an identity that does not describe the
   * shipped bytes can ship.
   */
  {
    name: "final-pass build identity self-verification removed",
    file: BUILD_ORCHESTRATOR,
    from: "  if (after.digest !== before.digest) {",
    to: "  if (false) {",
    tests: [BUILD_IDENTITY_TEST],
    reason: /recomputes the digest after the final pass and requires exact equality/,
  },
  /**
   * ADVERSARIAL CONTROL 7 (independent-review P1-5) — TanStack's built-in
   * reload is restored by unwiring the ownership plugin.
   */
  {
    name: "TanStack built-in reload restored",
    file: VITE_CONFIG,
    from: "      foreverTanstackReloadOwnership(),\n",
    to: "",
    tests: [TANSTACK_TEST],
    reason: /vite\.config\.ts installs the ownership plugin before anything else/,
  },
  /**
   * ADVERSARIAL CONTROL 8 (independent-review P1-5) — the forbidden raw key,
   * with the complete failing asset URL in it, is written again.
   */
  {
    name: "forbidden raw TanStack key restored",
    file: LAZY_LOADER,
    from: "          error = err;\n",
    to:
      "          error = err;\n" +
      // Split so this runner's own source does not carry the forbidden literal.
      `          sessionStorage.setItem("tanstack_router_${"reload:"}" + err.message, "1");\n`,
    tests: [TANSTACK_TEST],
    reason: /never touches sessionStorage, and never writes the forbidden key/,
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
  /**
   * ADVERSARIAL CONTROL 10 (independent-review P2-2) — the generated-Worker
   * contract goes back to skipping when the config is absent, which is exactly
   * how six assertions stopped running while the suite reported green.
   */
  {
    name: "generated Worker test skips when the config is absent",
    file: WORKER_CONFIG_TEST_FILE,
    from: '  it("retains the cron trigger", () => {',
    to: '  it.skip("retains the cron trigger", () => {',
    tests: [REPORTING_TEST],
    reason: /the focused suite contains no conditional .it\.skip. or .maybe. gate/,
  },
  /**
   * ADVERSARIAL CONTROL 11 (independent-review P2-3) — the browser harness
   * treats a missing driver as a skip instead of a failure.
   */
  {
    name: "browser harness tolerates a missing driver",
    file: BROWSER_RUNNER,
    from: '        "This is a FAILURE, not a skip — the browser proof cannot be reported as passing "',
    to: '        "skipping the browser proof "',
    tests: [REPORTING_TEST],
    reason: /a MISSING BROWSER DRIVER is a failure, never a skip/,
  },
  /**
   * ADVERSARIAL CONTROL 14 (independent-review P2-6) — skipped tests are added
   * to passed tests, which is the specific inaccuracy that concealed P2-2.
   */
  {
    name: "skipped tests counted as passed",
    file: FOCUSED_RUNNER,
    from: "  if (counts.passed !== counts.total) {",
    to: "  if (counts.passed + counts.skipped !== counts.total) {",
    tests: [REPORTING_TEST],
    reason: /NEVER adds skipped tests to passed tests/,
  },
  /**
   * ADVERSARIAL CONTROL 12 (independent-review P2-5) — the rollback hold is
   * removed, so a rollback can land on a tab mid-mutation.
   */
  {
    name: "rollback hold removed",
    file: RUNBOOK,
    from:
      "1. **The Owner is told to stop and take no Studio action.** Explicitly, before\n" +
      "   anything moves. Same wording as the forward hold.\n",
    to: "1. **Proceed.** No Owner hold is required for a rollback.\n",
    tests: [RUNBOOK_TEST],
    reason: /instructs the Owner not to interact before the rollback/,
  },
  /**
   * ADVERSARIAL CONTROL 13 (independent-review P2-4) — the observability
   * lifecycle decision is removed, leaving the sampling rate undefined again.
   */
  {
    name: "observability lifecycle removed",
    file: RUNBOOK,
    from: "- **Owner of the decision:** the release Owner.\n",
    to: "",
    tests: [RUNBOOK_TEST],
    reason: /names an owner, a volume bound and a trigger to revisit/,
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

  // -------------------------------------------------------------------------
  // NARROW-RE-REVIEW CONTROLS (RR2-P1-1, RR2-P2-1/2/3, RR2-P3-4/5)
  //
  // Each one restores, as closely as an edit can, the exact defect the
  // re-review measured. If any of these survives, the correction it belongs to
  // is not enforced by anything.
  // -------------------------------------------------------------------------

  /**
   * RR2 CONTROL 1 — the runbook spends the CLIENT asset identity as the Worker
   * release gate. This is the measured defect verbatim: for a server-only
   * release the endpoint reports the same value before and after, so the step
   * cannot distinguish the deployment it exists to verify.
   */
  {
    name: "runbook uses CLIENT_ASSET_ID as the Worker release identity",
    file: RUNBOOK,
    from:
      "11. **Verify the deployed WORKER VERSION, by UUID.** `wrangler deployments list`\n" +
      "    must show the candidate Worker version UUID recorded in step 2 holding 100%\n" +
      "    of traffic. **This is the release gate.** It is the only step that proves\n" +
      "    which Worker is deployed, and no client-side value can stand in for it.",
    to:
      "11. **Verify the release.** Confirm `/forever-client-assets.json` reports the new\n" +
      "    build id. **This is the release gate.**",
    tests: [RUNBOOK_TEST],
    reason: /makes the deployed Worker version UUID the release gate, not the endpoint/,
  },

  /**
   * RR2 CONTROL 2 — a server-only release recorded with no NEW Worker version.
   * The candidate equals the previous version, which means no upload happened,
   * which is exactly the release the client identity cannot see.
   */
  {
    name: "server-only release accepted without a new Worker version UUID",
    file: WORKER_RELEASE,
    from:
      "  if (candidate === previous) {\n" +
      '    return { accepted: false, refusal: "candidate_worker_version_not_new" };\n' +
      "  }",
    to: "  void previous;",
    tests: [SEPARATION_TEST],
    reason: /REFUSES a candidate Worker version equal to the previous one/,
  },

  /**
   * RR2 CONTROL 3 — the rollback target chosen by client identity. For a
   * server-only release the previous and current client identities are equal,
   * so this does not identify a version at all.
   */
  {
    name: "rollback target selected by client asset identity",
    file: WORKER_RELEASE,
    from:
      "  if (input.clientAssetId && target === input.clientAssetId) {\n" +
      '    return { accepted: false, refusal: "target_is_a_client_asset_id" };\n' +
      "  }",
    to: "  if (input.clientAssetId && target === input.clientAssetId) return { accepted: true };",
    tests: [SEPARATION_TEST],
    reason: /REFUSES a client asset identity as the rollback target/,
  },

  /**
   * RR2 CONTROL 4 — the harness accepts whatever document it is given. This is
   * the state in which every scenario ran against an HTTP 500 page.
   */
  {
    name: "browser harness accepts a document with an unexpected status",
    file: BROWSER_RUNNER,
    from:
      "  if (status !== expected.status) {\n" +
      "    await page.close();\n" +
      "    throw new ScenarioFailure(\n" +
      "      `document ${path} returned HTTP ${status}, expected ${expected.status}`,\n" +
      "      FAILURE_KINDS.DOCUMENT,\n" +
      "    );\n" +
      "  }",
    to: "  void status;",
    tests: [REPORTING_TEST],
    reason: /makes EVERY scenario declare the document status it requires/,
  },

  /**
   * RR2 CONTROL 5 — scenarios reported as passing without the real application
   * ever bootstrapping. The precondition is what makes a pass mean anything.
   */
  {
    name: "browser harness runs scenarios without an application bootstrap",
    file: BROWSER_RUNNER,
    from:
      '    if (boot.appMarker !== "mounted") {\n' +
      "      throw new BootstrapFailure(\n" +
      '        "the real application bootstrap marker never appeared — the root component of the real " +\n' +
      '          "route tree did not execute in this browser",\n' +
      "        evidence,\n" +
      "      );\n" +
      "    }",
    to: "    void boot;",
    tests: [REPORTING_TEST],
    reason: /REQUIRES a healthy application document before any scenario runs/,
  },

  /**
   * RR2 CONTROL 6 — the superseded verification table restored as current
   * evidence in the committed contract document.
   */
  {
    name: "obsolete test counts restored as current evidence",
    file: CONTRACT_DOC,
    from: "| Committed browser scenarios",
    to: "| Committed browser scenarios | 9/9 scenarios pass, 149 passed, 14/14 detected |\n| (restored obsolete row)",
    tests: [RUNBOOK_TEST],
    reason: /repeats no obsolete figure as present-tense evidence/,
  },

  /**
   * RR2 CONTROL 7 — the false absolute scope claim restored.
   */
  {
    name: "false protected-tree claim restored",
    file: CONTRACT_DOC,
    from: "- process rule violated in the prior correction session: **YES**;",
    to: "- `C:\\forever` never accessed;",
    tests: [RUNBOOK_TEST],
    reason: /states the violation, the exact extent, and the absence of contamination/,
  },

  /**
   * RR2 CONTROL 8 — a clear reported before stabilization has completed.
   */
  {
    name: "cleared reported before stabilization completes",
    file: RECOVERY,
    from:
      "  const settled = readRecoveryLedger((options.now ?? Date.now)(), options.storage);\n" +
      '  const stillPending = settled.status === "ok" && settled.ledger.pending !== null;\n' +
      "  return {\n" +
      "    accepted: true,\n" +
      '    outcome: stillPending ? "scheduled" : "cleared",\n' +
      "    historyRetained: ledger.history.length,\n" +
      "  };",
    to:
      "  return {\n" +
      "    accepted: true,\n" +
      '    outcome: "cleared",\n' +
      "    historyRetained: ledger.history.length,\n" +
      "  };",
    tests: [RECOVERY_TEST],
    reason: /reports SCHEDULED, not cleared, while the stabilization window is running/,
  },

  /**
   * RR2 CONTROL 9 — the byte cap put back where the declared maximum history
   * is unreachable, so the documented bound is not the effective one.
   */
  {
    name: "MAX_HISTORY made unreachable under the byte cap again",
    file: RECOVERY_CONTRACT,
    from: "export const STALE_ASSET_RECOVERY_MAX_SERIALIZED_BYTES = 1024;",
    to: "export const STALE_ASSET_RECOVERY_MAX_SERIALIZED_BYTES = 512;",
    tests: [RECOVERY_TEST],
    reason: /a FULL history at production identifier length fits inside the byte cap/,
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
