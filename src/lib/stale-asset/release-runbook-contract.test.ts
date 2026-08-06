/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — release-safety documentation.
 *
 * The runbook is a safety control, not prose. Two of its statements are the
 * difference between a safe release and a repeat of the incident:
 *
 *   1. a percentage rollout is prohibited while version affinity is absent;
 *   2. the FIRST release of this fix cannot protect an already-open tab, so it
 *      needs an explicit Owner hold.
 *
 * Both are pinned here so a later edit that softens or removes them fails a
 * named assertion rather than being noticed after the next release.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { check, resolveConfig } from "prettier";
import { describe, expect, it } from "vitest";

import {
  PREUPLOAD_EXPLICIT_BINDINGS_MARKER,
  SUPERSEDED_PREUPLOAD_MARKERS,
} from "./explicit-plain-text-bindings";
import {
  GENERATED_WORKER_CONFIG_PATH,
  PRODUCTION_VERSION_UPLOAD_SPEC,
} from "./worker-variable-preservation";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const runbook = read("docs/FOREVER_PRODUCTION_RELEASE_RUNBOOK.md");
const contract = read("docs/FOREVER_STUDIO_STALE_ASSET_RECOVERY.md");

/** Markdown wraps; a safety statement must not depend on where a line broke. */
const flat = (text: string) => text.replace(/\s+/g, " ");
const runbookFlat = flat(runbook);
const contractFlat = flat(contract);

/**
 * A blockquote wraps too, and its continuation lines carry a `>` marker. A
 * VERBATIM quotation of an external source must survive that, or the assertion
 * pins the line width rather than the words.
 */
const unquoted = (text: string) => flat(text.replace(/^[ \t]*>[ \t]?/gm, ""));
const runbookQuoted = unquoted(runbook);

describe("percentage rollout is prohibited without version affinity", () => {
  it("states the prohibition explicitly", () => {
    expect(runbook).toContain(
      "Until true version affinity exists, a percentage rollout is PROHIBITED",
    );
    expect(runbook).toContain("must not be used");
  });

  it("names the superseded sequence only as the thing being replaced", () => {
    // The old sequence may appear once, inside the fenced block that says it is
    // prohibited — never as an instruction.
    const occurrences = runbook.match(/5%\s*→\s*25%\s*→\s*100%/g) ?? [];
    expect(occurrences).toHaveLength(1);
    const index = runbook.indexOf(occurrences[0] ?? "");
    const prohibitionIndex = runbook.indexOf("is PROHIBITED");
    expect(prohibitionIndex).toBeGreaterThan(-1);
    expect(prohibitionIndex).toBeLessThan(index);
  });

  it("prescribes the atomic cutover instead", () => {
    expect(runbook).toContain("Atomic cutover");
    expect(runbookFlat).toContain("in ONE `wrangler versions deploy` invocation");
    expect(runbook).toContain("No intermediate percentage");
  });

  it("keeps the full corrected sequence, in order", () => {
    const steps = [
      "Build the candidate",
      "Upload the candidate at 0% traffic",
      "version preview URL",
      "transitive route-chunk graph",
      "VERSION_A → VERSION_B recovery locally",
      "Confirm the observability CONFIGURATION",
      "Pre-cutover version-override smoke and log gate",
      "Owner Studio hold",
      "closes or refreshes the existing Studio tab",
      "Atomic cutover",
      "Verify public routes",
      "Verify the deployed WORKER VERSION, by UUID",
      "Verify the full current asset graph",
      "Verify Workers Logs after the cutover",
      "confirms the authenticated dashboard",
      "Roll back immediately",
    ];
    let cursor = -1;
    for (const step of steps) {
      const at = runbook.indexOf(step, cursor + 1);
      expect(at, step).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("refuses Coralina repair and Retry inside a release", () => {
    expect(runbook).toContain("Do not begin Coralina repair or any Retry in the release task");
  });
});

describe("workers.dev and version affinity are described truthfully", () => {
  it("does not claim a zone Transform Rule protects this deployment", () => {
    expect(runbook).toContain("No zone Transform Rule protects this deployment");
    expect(runbook).toContain("Version affinity is NOT active");
    expect(runbook).toContain("not a zone under this account's control");
  });

  it("introduces no upstream Worker, service binding, custom domain or rule now", () => {
    expect(contractFlat).toContain(
      "no upstream Worker, service binding, custom domain or Transform Rule is introduced by this task",
    );
    expect(runbook).toContain("FOREVER-CLOUDFLARE-VERSION-AFFINITY-001");
    expect(contract).toContain("FOREVER-CLOUDFLARE-VERSION-AFFINITY-001");
    expect(contract).toContain("documentation only");
  });
});

describe("the first-bootstrap limitation is stated, not hidden", () => {
  it("says the deployed Worker lacks recovery and the first release cannot protect an open tab", () => {
    expect(runbookFlat).toContain(
      "The currently deployed Worker does not contain stale-chunk recovery",
    );
    expect(runbookFlat).toContain("cannot protect a tab that is already open on the old build");
  });

  it("requires the explicit Owner hold for the first release", () => {
    expect(runbookFlat).toContain("one explicit Owner tab refresh or closure hold");
    expect(runbook).toContain("separately approved compatibility bridge");
    expect(runbook).toContain("not hidden, not worked around, and not softened");
  });

  it("says later clients may self-recover once", () => {
    expect(runbook).toContain("may self-recover **once**");
  });
});

describe("the observability boundary is documented with its honest limit", () => {
  it("records what may and may not be logged server-side", () => {
    expect(contractFlat).toContain("closed event codes and bounded fields only");
    for (const forbidden of [
      "`Authorization` header",
      "cookie",
      "token",
      "email",
      "user id",
      "complete route query",
      "job id",
      "object key",
      "filename",
      "raw exception",
    ]) {
      expect(contract, forbidden).toContain(forbidden);
    }
  });

  it("states plainly that Workers Logs cannot prove a browser-only import failure", () => {
    expect(contractFlat).toContain(
      "Workers Logs cannot, on their own, prove a browser-only dynamic import failure when no request reaches Worker code",
    );
  });

  it("keeps a browser telemetry endpoint out of scope", () => {
    expect(contract).toContain("No public browser-error collection endpoint is introduced");
  });
});

// ---------------------------------------------------------------------------
// FOREVER-PR140-PREVIEW-LOG-GATE-REPAIR-005
//
// The runbook required "logs appear for the candidate" at a stage where the
// candidate is reachable ONLY through its versioned Preview URL — and Cloudflare
// excludes Workers Logs, Wrangler tail and Logpush for Preview URLs. The gate
// could not be satisfied by any operator, with any credential.
//
// A release report then recorded PASS while stating that same gate was not
// completed. These assertions pin BOTH corrections: the impossible demand is
// gone, and its absence can never be read as evidence the candidate was clean.
// ---------------------------------------------------------------------------

describe("preview URLs cannot be logged, and the runbook says so", () => {
  it("no longer demands candidate logs at the preview stage", () => {
    // The impossible instruction is GONE as an instruction.
    expect(runbook).not.toContain("**Enable and verify Workers Logs.**");

    // It survives in exactly one place, and only as a citation of the
    // superseded requirement — the same idiom SUPERSEDED_PREUPLOAD_MARKERS uses.
    // Deleting the words entirely would erase the record of what was wrong;
    // leaving them loose would let a reader mistake them for a live demand.
    const occurrences = runbookFlat.split("that logs appear for the candidate").length - 1;
    expect(occurrences).toBe(1);
    expect(runbookFlat).toContain(
      'The earlier revision of step 11 required confirming "that logs appear for the candidate"',
    );
  });

  it("states the platform limitation naming all three excluded routes", () => {
    expect(runbookQuoted).toContain(
      "You cannot view logs for Preview URLs today, this includes Workers Logs, Wrangler tail and Logpush",
    );
    // The citation must be present so the claim is checkable, not folklore.
    expect(runbook).toContain(
      "https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/#limitations",
    );
  });

  it("refuses to let a token or permission change be blamed for it", () => {
    expect(runbookFlat).toContain(
      "No API token, permission, binding, sampling rate or configuration change makes preview logs appear",
    );
  });

  it("classifies candidate preview logs as N/A rather than omitting them", () => {
    expect(runbookFlat).toContain("candidate preview log check");
    expect(runbookFlat).toContain("N/A — platform limitation");
    expect(runbookFlat).toContain("UNSUPPORTED (N/A — platform limitation)");
  });

  it("forbids reading the missing evidence as proof the candidate ran cleanly", () => {
    expect(runbookFlat).toContain(
      "THE ABSENCE OF CANDIDATE LOG EVIDENCE IS NOT EVIDENCE THAT THE CANDIDATE RAN CLEANLY",
    );
    expect(runbookFlat).toContain("Absence of log evidence is NEVER evidence of correctness");
    expect(runbookFlat).toContain("An N/A here is not a green check");
  });

  it("records that observability is dormant until the version is deployed", () => {
    expect(runbookFlat).toContain("Uploaded-but-undeployed observability is DORMANT");
    expect(runbookFlat).toContain("script-level");
    // The measurement error that produced the first misdiagnosis is named so it
    // is not repeated: version-detail simply has no observability field.
    expect(runbookFlat).toContain("returns **no** `observability` field at all, for ANY version");
  });

  it("keeps `wrangler tail --version-id` described as a FILTER, not an attach", () => {
    expect(runbookFlat).toContain(
      "`--version-id` FILTERS the deployed Worker's stream and cannot attach to a Preview URL",
    );
  });
});

// ---------------------------------------------------------------------------
// FOREVER-PR141-PR142-EVIDENCE-REVIEW-CORRECTIONS-007
//
// The first revision of §6 concluded that the first technically valid stage for
// candidate logs is AFTER the atomic cutover. Cloudflare's Version Overrides
// documentation refutes that: a version sitting at 0% INSIDE the current
// deployment can be invoked by an explicit per-request header, and those
// invocations are observable and attributable to the version.
//
// These assertions pin the corrected finding and, together with mutation
// controls 43-45, make the incorrect claim detectable if it is ever restored.
// ---------------------------------------------------------------------------

describe("a 0% version inside the deployment is invocable by version override", () => {
  it("REFUSES the retracted post-cutover-only conclusion, in every phrasing", () => {
    for (const retracted of [
      "The first technically valid stage is therefore AFTER the atomic cutover",
      "IMPOSSIBLE BY PLATFORM DESIGN",
      "which is the first point at which this candidate can produce a log at all",
      "This is the FIRST stage at which logs for this candidate can exist",
    ]) {
      expect(runbookFlat, retracted).not.toContain(retracted);
    }
  });

  it("quotes the retracted 0% inference EXACTLY once, and only to refute it", () => {
    // Deleting the words would erase the record of what was wrong; leaving them
    // loose would let a reader mistake them for a finding. Same idiom as the
    // superseded step-11 demand above: cite once, refute in the next sentence.
    const inference = "0% means zero invocations, so there is nothing to log";
    expect(runbookFlat.split(inference).length - 1).toBe(1);
    expect(runbookFlat).toContain(
      `to "${inference}". **That inference is WRONG, and Cloudflare refutes it`,
    );
  });

  it("quotes Cloudflare's own statement that a 0% version can be targeted", () => {
    expect(runbookQuoted).toContain(
      "You can use version overrides to send a request to a specific version of your Worker in the current deployment, even those set to serve 0% of traffic",
    );
    expect(runbook).toContain(
      "https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/",
    );
  });

  it("names the exact header and the exact prerequisite", () => {
    expect(runbookFlat).toContain("Cloudflare-Workers-Version-Overrides");
    expect(runbookQuoted).toContain(
      "A version override will only be applied if the specified version is in the current deployment",
    );
    // The two-version ceiling is what makes previous+candidate the only shape.
    expect(runbookQuoted).toContain(
      "Workers currently only supports serving **two** different versions in one deployment",
    );
  });

  it("records that Cloudflare presents this AS a pre-rollout smoke test", () => {
    expect(runbookQuoted).toContain(
      "Create a new deployment using `wrangler versions deploy` and specify 0% for the new version whilst keeping the previous version at 100%",
    );
    expect(runbookQuoted).toContain(
      "You can observe the version of your Worker that was invoked using Observability",
    );
  });

  it("states that state 3 is the FIRST valid candidate-log stage, before cutover", () => {
    expect(runbookFlat).toContain(
      "state 3 is the FIRST technically valid stage for candidate logs, and it is BEFORE the atomic cutover",
    );
  });

  it("keeps the five states distinct instead of collapsing them into '0%'", () => {
    for (const state of [
      "Uploaded, ABSENT from the active deployment",
      "In the current deployment at 0%",
      "Controlled requests carrying `Cloudflare-Workers-Version-Overrides`",
      "Normal production traffic during states 2–3",
      "After the atomic cutover",
    ]) {
      expect(runbookFlat, state).toContain(state);
    }
    // The specific conflation that produced the wrong conclusion is named.
    expect(runbookFlat).toContain('**The candidate is in state 1, NOT "at 0%".**');
  });

  it("refuses to dismiss overrides merely because percentage rollout is banned", () => {
    expect(runbookFlat).toContain("Version Overrides are NOT a percentage rollout");
    expect(runbookFlat).toContain("So §0 does not forbid state 2");
  });

  it("keeps §0's percentage prohibition intact and unweakened", () => {
    // The correction must not have become a licence for a gradual rollout.
    expect(runbook).toContain(
      "Until true version affinity exists, a percentage rollout is PROHIBITED",
    );
    expect(runbookFlat).toContain("No intermediate percentage");
  });
});

describe("the Forever-specific limits of a 0% override smoke test are PROVEN, not asserted", () => {
  it("determines that scripted probes are permitted and browsers are not", () => {
    expect(runbookFlat).toContain(
      "Determination: YES for scripted, header-bearing probes. NO for any browser session",
    );
  });

  it("proves the browser limit from the documented Transform Rule exclusion", () => {
    expect(runbookQuoted).toContain(
      "Transform Rules require your Worker to be on a route on a zone you control. They are not available for Workers served on `*.workers.dev` domains",
    );
    expect(runbookFlat).toContain("one missing zone disables both");
  });

  it("keeps the Owner browser acceptance gate AFTER the cutover", () => {
    expect(runbookFlat).toContain("they do **not** move the **Owner browser acceptance** gate");
  });

  it("records that cron invocations cannot be overridden at all", () => {
    expect(runbookFlat).toContain(
      "A scheduled invocation carries no request, so there is no header to set",
    );
  });

  it("separates INVOCABLE from OBSERVABLE and demands both be measured", () => {
    expect(runbookFlat).toContain("Overrides make the candidate INVOCABLE, not OBSERVABLE");
    expect(runbookFlat).toContain("Re-read `GET .../workers/scripts/forever/script-settings`");
  });

  it("treats the --keep-vars hazard on `versions deploy` as UNPROVEN, not decided", () => {
    expect(runbookFlat).toContain("NOT established here in either direction");
    expect(runbookFlat).toContain("re-run `npm run release:verify-bindings`");
  });
});

describe("the four separate Owner authorizations are enumerated", () => {
  it("names A1 through A4 as four decisions, not one", () => {
    expect(runbookFlat).toContain("### The FOUR separate Owner authorizations");
    expect(runbookFlat).toContain("A1 — include the candidate in the active deployment at 0%");
    expect(runbookFlat).toContain("A2 — send controlled requests using Version Overrides");
    expect(runbookFlat).toContain(
      "A3 — read the resulting logs and attribute them to the exact candidate UUID",
    );
    expect(runbookFlat).toContain("A4 — the atomic cutover");
    expect(runbookFlat).toContain("none implies the next");
  });

  it("restricts the override probe set to named, non-mutating requests", () => {
    expect(runbookFlat).toContain("every request in it must be **non-mutating**");
    expect(runbookFlat).toContain(
      "No POST, no Studio write, no job creation, no authenticated session, no cron",
    );
  });

  it("states plainly that this document does not authorize the state-2 mutation", () => {
    expect(runbookFlat).toContain(
      "the state-2 deployment mutation described here is NOT authorized by this document",
    );
    expect(runbookFlat).toContain("has not been requested, authorized or performed");
  });
});

describe("the deferred log gate stays mandatory and cannot be rounded up", () => {
  it("keeps Workers Logs verification as a REQUIRED post-cutover gate", () => {
    expect(runbookFlat).toContain("Verify Workers Logs after the cutover. REQUIRED.");
    expect(runbookFlat).toContain("logs are ACTUALLY RETURNED");
  });

  it("refuses to call the post-cutover check the first possible stage", () => {
    expect(runbookFlat).toContain(
      "Step 16b is retained as a required acceptance check. It is NOT the first possible candidate-log stage**",
    );
  });

  it("gives step 11b a STOP failure mode and step 16b a ROLLBACK failure mode", () => {
    expect(runbookFlat).toContain(
      "Traffic has NOT moved, so failure is a refusal to proceed, never a rollback of traffic",
    );
    expect(runbookFlat).toContain("Traffic has ALREADY moved, so failure is a rollback");
  });

  it("forces the pre-cutover gate to be recorded even when it is not used", () => {
    expect(runbookFlat).toContain("pre-cutover candidate log gate");
    expect(runbookFlat).toContain("`DECLINED BY OWNER`");
    expect(runbookFlat).toContain("It is not `N/A`");
  });

  it("treats unreadable or empty logs as NOT VERIFIED, never as clean", () => {
    expect(runbookFlat).toContain('an empty result is "not verified", not "clean"');
    expect(runbookFlat).toContain("Logs that cannot be read at all are NOT a pass");
    expect(runbookFlat).toContain("it is never rounded up to");
  });

  it("makes a failure there a rollback trigger rather than a note", () => {
    expect(runbookFlat).toContain("A failure here is a rollback trigger under §5, not a note");
  });

  it("requires the cutover authorization to carry the log gate's honest verdict", () => {
    expect(runbookFlat).toContain(
      "the state of the pre-cutover log gate — `PASS`, `NOT VERIFIED`, or `DECLINED BY OWNER` — recorded honestly",
    );
    expect(runbookFlat).toContain("A cutover performed without all five is out of contract");
  });

  it("keeps candidate-upload PASS from implying a cutover", () => {
    expect(runbookFlat).toContain(
      "A candidate-upload PASS still authorizes NOTHING beyond a verified artefact sitting outside the deployment",
    );
  });

  it("keeps every candidate-upload gate that CAN hold", () => {
    // The repair must not have quietly dropped the checks that caught the two
    // rejected candidates.
    for (const kept of [
      "binding fingerprint equality",
      "public-route probes with zero 5xx",
      "the full transitive `/assets/*` graph",
      "the Studio chunk graph",
    ]) {
      expect(runbookFlat, kept).toContain(kept);
    }
  });
});

describe("wrangler tail is not presented as a preview instrument", () => {
  it("no longer implies tail needs nothing and works during the release", () => {
    expect(runbookFlat).not.toContain(
      "**Temporary deeper observation** during a release uses `wrangler tail`, which needs no deployment and no configuration change.",
    );
  });

  it("says plainly that tail cannot observe a versioned Preview URL", () => {
    expect(runbookFlat).toContain("`wrangler tail` cannot observe a versioned Preview URL");
  });

  it("restores tail as a step 11b instrument, before the cutover", () => {
    expect(runbookFlat).toContain("It becomes usable at **step 11b**");
    expect(runbookFlat).toContain(
      "the wording that replaced it wrongly deferred tail to after the cutover",
    );
  });
});

describe("the completed PR140 upload is classified honestly", () => {
  it("records the upload as succeeded and the release as blocked before cutover", () => {
    expect(runbookFlat).toContain("Status of the PR #140 candidate, recorded accurately");
    expect(runbookFlat).toContain("**BLOCKED BEFORE CUTOVER**");
    expect(runbookFlat).toContain(
      "The release is not accepted and no cutover is authorized by any of the above",
    );
  });

  it("states that a required gate which did not hold is a BLOCKED verdict", () => {
    expect(runbookFlat).toContain(
      "a required gate that did not hold is a BLOCKED verdict, and a gate that cannot hold must be corrected rather than reported around",
    );
  });

  it("records the candidate's logs as not-yet-obtainable rather than clean", () => {
    expect(runbookFlat).toContain("NOT OBTAINABLE IN STATE 1 — not verified, not clean");
    // "Not yet obtainable" and "impossible" are different claims, and only the
    // weaker one is supported: state 1 is reversible by an authorized mutation.
    expect(runbookFlat).toContain('**"Not yet obtainable" and "impossible" are different words.**');
  });

  it("corrects the row that conflated absence from the deployment with 0%", () => {
    expect(runbookFlat).toContain(
      "STATE 1 — ABSENT from the active deployment.** It holds no percentage at all",
    );
    expect(runbookFlat).not.toContain("| Candidate traffic | **0%** — absent from the active");
  });

  it("leaves the candidate in place as evidence", () => {
    expect(runbookFlat).toContain("unmodified and undeleted");
  });
});

describe("the correction introduces no Cloudflare write path", () => {
  it("still permits only `versions upload`, never a deploy, as the spawned command", () => {
    expect(PRODUCTION_VERSION_UPLOAD_SPEC.args.slice(0, 2)).toEqual(["versions", "upload"]);
    expect(PRODUCTION_VERSION_UPLOAD_SPEC.args).not.toContain("deploy");
    expect(PRODUCTION_VERSION_UPLOAD_SPEC.args).not.toContain("--percentage");
  });

  it("adds no deploy, traffic or delete command to any release script", () => {
    // §6 documents the cutover; it must not hand the operator a runnable
    // traffic-moving command that the release tooling would perform itself.
    const releaseScripts = [
      "scripts/release/upload-worker-version.mjs",
      "scripts/release/capture-worker-version-bindings.mjs",
      "scripts/release/verify-binding-preservation.mjs",
    ];
    for (const path of releaseScripts) {
      const source = read(path);
      expect(source, path).not.toContain("versions deploy");
      expect(source, path).not.toContain("--percentage");
    }
  });

  it("keeps the rejected-candidate preservation rule intact", () => {
    expect(runbookFlat).toContain("a candidate that is not accepted is evidence, not rubbish");
  });
});

// ---------------------------------------------------------------------------
// P2-5 — the rollback gets the SAME holds as the forward cutover
// ---------------------------------------------------------------------------

describe("rollback is held as strictly as the cutover", () => {
  it("says plainly that recovery does not make an uncontrolled rollback safe", () => {
    expect(runbookFlat).toContain(
      "Stale-asset recovery does not make an uncontrolled rollback safe",
    );
    expect(runbookFlat).toContain("A rollback is a release in the other direction");
  });

  it("instructs the Owner not to interact before the rollback", () => {
    expect(runbookFlat).toContain("The Owner is told to stop and take no Studio action");
  });

  it("requires no mutation in progress, and waits if one is", () => {
    expect(runbookFlat).toContain("No mutation is in progress");
    expect(runbookFlat).toContain("the rollback WAITS for it to settle");
  });

  it("requires current-version Studio tabs to be closed or refreshed", () => {
    expect(runbookFlat).toContain(
      "Every current-version Studio tab is closed or refreshed as directed",
    );
  });

  it("requires the rollback to be atomic, with no partial or percentage step", () => {
    expect(runbookFlat).toContain("The rollback itself is ATOMIC");
    expect(runbookFlat).toContain("No intermediate percentage, no partial rollback");
  });

  it("refuses the invalid pre-R2 Worker as a rollback target, by id", () => {
    expect(runbookFlat).toContain("not** the invalid pre-R2 Worker `9919f28c`");
  });

  it("requires the full old asset graph and a FRESH authenticated Studio check after", () => {
    expect(runbookFlat).toContain("Verify the full old asset graph");
    expect(runbookFlat).toContain(
      "The Owner opens Studio FRESH and confirms the authenticated dashboard renders",
    );
    expect(runbookFlat).toContain("This is the rollback acceptance gate");
  });

  it("refuses Coralina repair, Retry and re-upload during a rollback", () => {
    expect(runbookFlat).toContain(
      "Never during a rollback:** no Coralina repair, no Retry, no re-upload",
    );
  });
});

// ---------------------------------------------------------------------------
// P2-4 — the observability lifecycle is a decision, not an implication
// ---------------------------------------------------------------------------

describe("the observability sampling lifecycle is defined", () => {
  it("names the chosen post-release setting explicitly", () => {
    expect(runbookFlat).toContain("head_sampling_rate: 1` is **PERMANENT**");
    expect(runbookFlat).toContain("Chosen setting:** `observability.enabled = true`");
    expect(runbookFlat).toContain("indefinitely");
  });

  it("corrects the framing: 1 is the documented default, not an elevation", () => {
    expect(runbookFlat).toContain("is Cloudflare's documented DEFAULT for Workers Logs");
    expect(runbookFlat).toContain("there is nothing elevated about it");
  });

  it("names an owner, a volume bound and a trigger to revisit", () => {
    expect(runbookFlat).toContain("Owner of the decision:** the release Owner");
    expect(runbookFlat).toContain("20M log events per month");
    expect(runbookFlat).toContain("$0.60 per million");
    expect(runbookFlat).toContain("Trigger to revisit:");
  });

  it("acknowledges that changing it needs another deployment, and how to observe without one", () => {
    expect(runbookFlat).toContain("reducing it would require **another deployment**");
    expect(runbookFlat).toContain("uses `wrangler tail`, which needs no deployment");
  });
});

// ---------------------------------------------------------------------------
// P3-7 — Cloudflare's recommended post-cutover 404 monitoring
// ---------------------------------------------------------------------------

describe("the post-cutover asset-404 signal is named", () => {
  it("is a numbered step before the acceptance gate", () => {
    expect(runbookFlat).toContain("Watch the asset-404 rate for the first minutes after cutover");
    expect(runbookFlat).toContain("A rising asset-404 rate is a rollback trigger");
  });
});

// ---------------------------------------------------------------------------
// P1-4 / P3-3 — the release builds through the output-derived orchestrator
// ---------------------------------------------------------------------------

describe("the release cannot pin or reuse a build identity", () => {
  it("builds through the output-derived orchestrator, not a bare vite build", () => {
    expect(runbookFlat).toContain("Build the candidate with `npm run build`");
    expect(runbookFlat).toContain("RE-VERIFIES that the sealed output reproduces that digest");
    expect(runbookFlat).toContain("A build that does not self-verify fails and must not ship");
  });

  it("states that a manual identity may not be pinned for production", () => {
    expect(runbookFlat).toContain("may NOT be pinned for a production release");
    expect(runbookFlat).toContain("The build refuses it outright");
  });
});

// ---------------------------------------------------------------------------
// RR2-P1-1 — the runbook separates CLIENT ASSET COMPATIBILITY from the
// IMMUTABLE WORKER RELEASE IDENTITY, in both directions
// ---------------------------------------------------------------------------

describe("the runbook keeps client asset identity out of the release gate", () => {
  it("declares the two identities and what each is allowed to prove", () => {
    expect(runbookFlat).toContain("TWO IDENTITIES, AND WHAT EACH ONE IS ALLOWED TO PROVE");
    expect(runbookFlat).toContain("`CLIENT_ASSET_ID` proves client asset compatibility only");
    expect(runbookFlat).toContain(
      "The Cloudflare Worker version UUID proves the immutable deployed Worker",
    );
  });

  it("forbids the client asset identity as proof of the release, by name", () => {
    // The five things RR2-P1-1 found it being spent on.
    for (const forbidden of [
      "the exact Worker release",
      "the server runtime identity",
      "the production traffic allocation",
      "the rollback target",
      "complete release equality",
    ]) {
      expect(runbookFlat, forbidden).toContain(forbidden);
    }
    expect(runbookFlat).toContain("It may never be used to prove");
  });

  it("requires a NEW immutable Worker version UUID for every uploaded candidate", () => {
    expect(runbookFlat).toContain(
      "The wrapper records the immutable Worker version UUID mechanically and requires it to be NEW",
    );
    expect(runbookFlat).toContain(
      "Wrangler's documented structured `version-upload` result is consumed in memory",
    );
    expect(runbookFlat).toContain("candidate_worker_version_not_new` STOPS the release");
  });

  it("makes the deployed Worker version UUID the release gate, not the endpoint", () => {
    expect(runbookFlat).toContain("Verify the deployed WORKER VERSION, by UUID");
    expect(runbookFlat).toContain("This is the release gate");
    expect(runbookFlat).toContain("This checks client asset compatibility, not the release");
    expect(runbookFlat).toContain(
      "it will report the SAME value as before the cutover, and that is the expected, correct " +
        "answer",
    );
  });

  it("selects and confirms the rollback target by Worker version UUID only", () => {
    expect(runbookFlat).toContain("The rollback target is verified BY WORKER VERSION UUID");
    expect(runbookFlat).toContain(
      "The rollback target is never selected or confirmed by `CLIENT_ASSET_ID`",
    );
    expect(runbookFlat).toContain(
      "If the previous Worker version UUID was not retained, the rollback STOPS",
    );
    expect(runbookFlat).toContain("Verify the rolled-back WORKER VERSION, by UUID");
    expect(runbookFlat).toContain("This is the rollback gate");
  });

  it("never claims the client asset endpoint proves a build or a release", () => {
    // The two exact sentences RR2-P1-1 named, in either wording.
    expect(runbookFlat).not.toContain("reports the new build id");
    expect(runbookFlat).not.toContain("reports the previous build identity");
    expect(runbookFlat).not.toContain("reports the new release");
  });

  it("records all eight release provenance facts together", () => {
    expect(runbookFlat).toContain("The release provenance record");
    for (const fact of [
      "exact Git commit SHA",
      "exact Git tree SHA",
      "`CLIENT_ASSET_ID`",
      "immutable candidate Worker version UUID",
      "immutable previous Worker version UUID",
      "compatibility date",
      "canonical binding/config fingerprint",
      "migration ledger state",
    ]) {
      expect(runbookFlat, fact).toContain(fact);
    }
  });

  it("states that the local manifest is not a Worker release identity", () => {
    expect(runbookFlat).toContain("`.forever-build/release-manifest.json`");
    expect(runbookFlat).toContain("Its `workerVersionId` is **always `null`**");
    expect(runbookFlat).toContain(
      "Fields 4 and 5 are added to the release evidence **after** the authorized upload",
    );
  });

  it("states the server-only case explicitly, in both directions", () => {
    expect(runbookFlat).toContain(
      "A server-only source change may keep the same `CLIENT_ASSET_ID`; it always moves the Git " +
        "tree SHA, and it always produces a new Worker version UUID when uploaded",
    );
    expect(runbookFlat).toContain("May legitimately NOT change");
  });
});

// ---------------------------------------------------------------------------
// RR2-P3-3 — the documents this task owns are Prettier-clean, and something
// enforces it
// ---------------------------------------------------------------------------

describe("the release documents are Prettier-clean", () => {
  /**
   * The PR states that its changed scope is Prettier-clean. It was not: the
   * runbook failed `prettier --check`, and nothing in the repository checked
   * markdown formatting, so the claim rested on nobody looking.
   *
   * The scope here is deliberately the two documents this task introduces, not
   * `docs/**`. Seventy-six unrelated documents on `main` are also unformatted,
   * and reformatting them would be an unrelated change hidden inside a release
   * correction. This asserts what this PR is responsible for.
   */
  const OWNED = [
    "docs/FOREVER_PRODUCTION_RELEASE_RUNBOOK.md",
    "docs/FOREVER_STUDIO_STALE_ASSET_RECOVERY.md",
  ];

  it.each(OWNED)("%s passes prettier --check with the repository config", async (path) => {
    const absolute = resolve(process.cwd(), path);
    const options = await resolveConfig(absolute);
    // Line endings are normalised first: this checkout is `core.autocrlf`
    // Windows, and a CRLF working copy is a checkout artefact rather than a
    // formatting defect in the committed content.
    const source = readFileSync(absolute, "utf8").split("\r\n").join("\n");
    await expect(check(source, { ...options, filepath: absolute })).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RR2-P2-1 / RR2-P2-3 — the published evidence and the published scope
// statement are both current and both true
// ---------------------------------------------------------------------------

describe("no superseded verification figure is presented as current", () => {
  /**
   * The PR body carried the original implementation's table — `149 passed`,
   * `9/9`, `14/14`, `5114`, `4965` and a stale head SHA — unmarked, about 220
   * lines above the corrected one, so the document asserted both sets of
   * numbers as its own verification. The incident history is kept; the numbers
   * are labelled.
   */
  const OBSOLETE = ["149 passed", "9/9 scenarios", "14/14 detected", "5114", "4965", "f7f53e2"];

  it("labels the superseded evidence rather than deleting the history", () => {
    expect(contract).toContain("SUPERSEDED BY INDEPENDENT REVIEW AND CORRECTION");
    expect(contractFlat).toContain("Only the values below are current");
  });

  it("repeats no obsolete figure as present-tense evidence", () => {
    // They may appear once, inside the sentence that declares them superseded.
    const superseded = contract.slice(
      contract.indexOf("SUPERSEDED BY INDEPENDENT REVIEW AND CORRECTION") - 600,
      contract.indexOf("SUPERSEDED BY INDEPENDENT REVIEW AND CORRECTION") + 200,
    );
    for (const figure of OBSOLETE) {
      const occurrences = contract.split(figure).length - 1;
      expect(occurrences, `${figure} appears ${occurrences} time(s)`).toBeLessThanOrEqual(1);
      if (occurrences === 1) expect(superseded, figure).toContain(figure);
    }
  });

  it("points at the machine-produced counts as the authority", () => {
    expect(contract).toContain(".forever-build/focused-suite-counts.json");
    expect(contract).toContain("browser-<engine>-results.json");
  });
});

describe("the protected-tree disclosure is accurate and preserved", () => {
  it("never publishes the false absolute claim", () => {
    // RR2-P2-3. The claim was false as written for the prior session.
    expect(contract).not.toContain("`C:\forever` never accessed");
    expect(contract).not.toContain("never accessed in any way");
    expect(contract).not.toContain("untouched in every sense");
  });

  it("states the violation, the exact extent, and the absence of contamination", () => {
    expect(contractFlat).toContain(
      "process rule violated in the prior correction session: **YES**",
    );
    expect(contractFlat).toContain("one directory listing occurred");
    expect(contractFlat).toContain("one filename was returned");
    expect(contractFlat).toContain(
      "no file was opened, read, copied, modified or used as a Git source",
    );
    expect(contractFlat).toContain("source contamination demonstrated: **NO**");
    expect(contractFlat).toContain(
      "the final correction session did not access the protected tree",
    );
  });
});

/**
 * FOREVER-WRANGLER-KEEP-VARS-CORRECTION-001.
 *
 * A candidate uploaded from exact merged main lost two deployment-managed
 * variables and returned HTTP 500 on its preview. It was caught at 0% and no
 * traffic moved. Every statement that prevents a repeat is a safety control,
 * so each is pinned here rather than trusted to survive a later edit.
 */
describe("the runbook preserves deployment-managed Worker variables", () => {
  it("prescribes --keep-vars on the candidate upload, in the sequence itself", () => {
    expect(runbookFlat).toContain("wrangler versions upload --keep-vars");
    expect(runbookFlat).toContain("`--keep-vars` is not optional");
  });

  it("states that omitted vars are DELETED when keep-vars is false", () => {
    // The Cloudflare quote is a blockquote, so `>` survives flattening at each
    // wrapped line. Assert within a line rather than across the wrap.
    expect(runbookFlat).toContain("Wrangler will delete all vars before setting");
    expect(runbookFlat).toContain("The default is `false`");
    expect(runbookFlat).toContain('"delete all vars, then apply the none I declared"');
  });

  it("states that dashboard/deployment-managed vars must be preserved", () => {
    expect(runbookFlat).toContain("deployment plane remains the **source of truth**");
    expect(runbook).toContain("SUPABASE_URL");
    expect(runbook).toContain("STUDIO_STORAGE_WRITE_PROVIDER");
  });

  it("states that surviving secrets do NOT prove plain-text vars survived", () => {
    expect(runbookFlat).toContain("Surviving secrets are NOT evidence");
    expect(runbookFlat).toContain("Secrets are never deleted, with or without the flag");
    expect(runbookFlat).toContain("measuring the one thing that could not have failed");
  });

  it("requires the candidate binding fingerprint to equal the live one before preview acceptance", () => {
    expect(runbookFlat).toContain(
      "the candidate's binding fingerprint must EQUAL the live Worker's",
    );
    expect(runbookFlat).toContain("values never read");
  });

  it("rejects a candidate with fewer bindings even at 0% traffic", () => {
    expect(runbookFlat).toContain(
      "a candidate carrying fewer bindings than the live Worker is REJECTED",
    );
    expect(runbookFlat).toContain("even though it holds 0% of traffic");
  });

  it("forbids cutting over a candidate that 500s or lacks either variable", () => {
    expect(runbookFlat).toContain("never cut over a candidate that returns 500");
    expect(runbookFlat).toContain('no percentage, no "verify it after", no exceptions');
  });

  it("names BOTH halves — no vars block AND keep_vars — as jointly required", () => {
    expect(runbookFlat).toContain("repository **overwrites** the vars");
    expect(runbookFlat).toContain("Wrangler **deletes** the vars");
    expect(runbookFlat).toContain("Both are required");
  });

  it("records the failed candidate as a safe pre-cutover finding, not an incident", () => {
    expect(runbookFlat).toContain("This was a safe pre-cutover finding, not a production incident");
    expect(runbookFlat).toContain("production traffic never moved");
    expect(runbookFlat).toContain("Coralina remained contained");
  });

  it("carries no production variable value in the documentation itself", () => {
    expect(runbook).not.toMatch(/https:\/\/[a-z0-9]{20}\.supabase\.co/);
  });
});

/**
 * FOREVER-PR140-CORRECTIONS-002.
 *
 * Four documentation facts the independent review found stated wrongly or not at
 * all. Each is a safety statement — an operator reading the wrong one draws the
 * wrong conclusion about what a release holds, what it proves and what ran — so
 * each is pinned rather than trusted to survive an edit.
 */
describe("the runbook describes the explicit-binding release truthfully", () => {
  it("calls the upload-specification digest a SALTED VERIFICATION digest, not a content address", () => {
    expect(runbookFlat).toContain("salted verification digest");
    expect(runbookFlat).toContain("not a content address");
    expect(runbookFlat).toContain("not reproducible");
    expect(runbookFlat).toContain("not comparable across releases");
    // And it distinguishes the two digests rather than describing both as one.
    expect(runbookFlat).toContain("The two digests are not the same kind of thing");
    expect(runbookFlat).toContain(
      "`releaseManifestSha256` is an ordinary, reproducible SHA-256 of a value-free file",
    );
    // The superseded wording is gone.
    expect(runbookFlat).not.toContain("normalized upload-specification SHA-256");
  });

  it("states which process holds the release inputs, and which two do not", () => {
    expect(runbookFlat).toContain("Exactly which process holds what");
    expect(runbookFlat).toContain("The wrapper process DOES hold both release inputs");
    expect(runbookFlat).toContain("The PREUPLOAD child does NOT");
    expect(runbookFlat).toContain("The Wrangler child does NOT either");
    expect(runbookFlat).toContain("deleted from its environment");
    expect(runbookFlat).toContain(
      "Wrangler receives the two values through **exactly one channel**",
    );
    expect(runbookFlat).toContain(
      "The specification is deleted once the launcher returns or throws",
    );
    expect(runbookFlat).toContain("A lost exclusive-create race is the same fail-closed STOP");
  });

  it("names the CURRENT Wrangler serialization proof and no stale one", () => {
    expect(runbook).toContain("wrangler-plain-text-serialization.test.ts");
    expect(runbookFlat).toContain("An equivalent proof exists for the mechanism that replaced it");
    // The deleted proof is described as deleted, never cited as evidence.
    expect(runbookFlat).toContain("That inherit proof is deleted");
    expect(runbook).not.toContain("wrangler-inherit-serialization");
    expect(runbookFlat).not.toContain(
      "The proof has been deleted rather than left to defend a mechanism",
    );
    // And the claim it supports stays inside what it can measure.
    expect(runbookFlat).toContain("It is evidence about WRANGLER's serialization only");
  });
});

// ---------------------------------------------------------------------------
// FOREVER-PR140-CORRECTIONS-002 — the release-check mapping, including the
// explicit actionlint N/A waiver
// ---------------------------------------------------------------------------

describe("the release-check mapping records what runs and what is not applicable", () => {
  it("publishes a mapping of every claimed gate to the command that produces it", () => {
    expect(runbook).toContain("## 2d. RELEASE CHECK MAPPING");
    for (const command of [
      "npm run build",
      "npx vitest run",
      "npm run release:verify-bindings",
      "npm run release:wrangler-gate",
      "npm run release:keep-vars-mutations",
    ]) {
      expect(runbook, command).toContain(command);
    }
  });

  it("records actionlint as an explicit N/A waiver, in the exact wording", () => {
    expect(runbook).toContain(
      "`actionlint: N/A — repository contains no GitHub Actions workflows`",
    );
    expect(runbookFlat).toContain("owner-approved, repository-state-specific waiver");
  });

  it("refuses the two ways a waiver becomes a lie", () => {
    // A workflow created to satisfy a linter, and a check claimed as passing.
    expect(runbookFlat).toContain("A workflow was **not** created to satisfy the check");
    expect(runbookFlat).toContain("`actionlint` was **not** installed");
    expect(runbookFlat).toContain("the check is **not** reported as passing");
  });

  it("expires the waiver automatically the moment a workflow file exists", () => {
    expect(runbookFlat).toContain("The waiver expires automatically");
    expect(runbookFlat).toContain(
      "If any file is added under `.github/workflows`, this waiver is void",
    );
  });

  it("forbids presenting an absent CI as a successful status check", () => {
    expect(runbookFlat).toContain("Absence of CI is never a green status check");
    expect(runbookFlat).toContain("no status checks at all");
    expect(runbookFlat).toContain('An empty check list means "nothing ran"');
  });

  it("scopes lint rather than editing shared configuration for one checkout", () => {
    expect(runbookFlat).toContain("Why lint is scoped rather than repository-wide");
    expect(runbookFlat).toContain("environmental limitation of this working copy");
    expect(runbookFlat).toContain("not** a reason to edit the ESLint configuration");
  });

  it("the waiver is TRUE of this repository right now", () => {
    // The waiver is repository-state-specific, so the state is measured rather
    // than assumed: the moment a workflow exists, this fails and the waiver in
    // the runbook must be replaced by a real actionlint run.
    expect(existsSync(resolve(process.cwd(), ".github/workflows"))).toBe(false);
  });
});

/**
 * FOREVER-PR138-MERGE-BLOCKER-CORRECTION-002.
 *
 * The independent review of the correction above returned CHANGES_REQUIRED on
 * two counts the runbook is responsible for: it told the operator to trust a
 * substring test, and it named a preflight whose input no tool produced. Both
 * are documentation failures as much as code failures, so the corrected
 * sequence is pinned here.
 */
describe("the runbook prescribes the MECHANICAL release sequence", () => {
  it("captures the live binding snapshot with a tool, before any upload", () => {
    expect(runbookFlat).toContain("Discover and capture the LIVE Worker UUID, mechanically");
    expect(runbook).toContain("npm run release:capture-bindings");
    expect(runbookFlat).toContain(
      "GET /accounts/{account_id}/workers/scripts/{script_name}/versions/{version_id}",
    );
    expect(runbook).toContain("result.resources.bindings");
  });

  it("never tells an operator to hand-write binding JSON", () => {
    expect(runbookFlat).toContain("Do not hand-write this file");
    expect(runbookFlat).toContain("Never hand-write a binding snapshot");
  });

  it("uploads through the structured wrapper, not a typed shell command", () => {
    expect(runbook).toContain("npm run release:upload-version");
    expect(runbookFlat).toContain("through the structured wrapper");
    expect(runbookFlat).toContain("with **no shell**");
  });

  it("captures the candidate snapshot and only then runs the exact preflight", () => {
    const sequence = runbook.slice(runbook.indexOf("## 2. The release sequence"));
    const capture = sequence.indexOf("Capture the CANDIDATE's binding snapshot");
    const verify = sequence.indexOf("Run the strict EXACT-fingerprint preflight");
    const reject = sequence.indexOf("Reject any identity or binding mismatch");
    const preview = sequence.indexOf("Verify the candidate on its own version preview URL");
    for (const index of [capture, verify, reject, preview]) expect(index).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(capture);
    expect(reject).toBeGreaterThan(verify);
    expect(preview).toBeGreaterThan(reject);
  });

  it("requires the two fingerprints to be EQUAL as a pass condition", () => {
    expect(runbookFlat).toContain("**the two fingerprints are EQUAL**");
    expect(runbookFlat).toContain("no name is duplicated");
    expect(runbookFlat).toContain("no binding was added");
  });

  it("pins PREUPLOAD to the exact deployment-discovery UUID", () => {
    expect(runbook).toContain("--live-version-id <exact-discovered-live-worker-version-uuid>");
    expect(runbook).toContain(
      "--expected-live-version <exact-discovered-live-worker-version-uuid>",
    );
    expect(runbookFlat).toContain("liveSnapshot.workerVersionId");
    expect(runbookFlat).toContain("omitted, malformed, older or substituted UUID is a named STOP");
  });

  it("pins POSTUPLOAD to the mechanical candidate receipt before preview acceptance", () => {
    expect(runbook).toContain("--receipt .forever-build/worker-version-provenance.json");
    expect(runbook).toContain(
      "--candidate-release-provenance .forever-build/worker-version-provenance.json",
    );
    expect(runbook).toContain("--release-provenance .forever-build/worker-version-provenance.json");
    expect(runbookFlat).toContain("An operator never retypes the candidate UUID");

    // POSITIONAL, not "appears somewhere". Asserting the two tokens anywhere in
    // the document made this control forgeable: any later section that merely
    // MENTIONS them — a status table, an incident record — satisfied the check
    // while step 7's actual gate could be deleted. Mutation control 26 removes
    // precisely this sentence, so the sentence is what must be pinned.
    expect(runbookFlat).toContain(
      "Only when step 6 reports both `workerVersionIdentityOk: true` and `BINDINGS_PRESERVED` does preview acceptance begin",
    );
  });

  it("states that a substring test is NOT proof, and lists what it accepted", () => {
    expect(runbookFlat).toContain("A substring test is not proof");
    expect(runbook).toContain("--keep-vars=false");
    expect(runbook).toContain("--no-keep-vars");
    expect(runbook).toContain("--keep-vars-disabled");
    expect(runbookFlat).toContain("Ten commands that DELETE");
    // The discredited check is never presented as evidence.
    expect(runbook).not.toContain('includes("--keep-vars")');
  });

  /**
   * FOREVER-PR140-FINAL-REVIEW-003 — the published argv is DERIVED, never
   * retyped.
   *
   * This assertion used to restate the argv as a hard-coded literal, and the
   * literal was the SUPERSEDED one: §2b published
   * `--config .output/server/wrangler.json`, the immutable generated
   * configuration. That is the artefact `verifyUploadSpec` refuses by name with
   * `wrong_config_path` — it declares neither deployment-managed plain-text
   * binding, so an upload performed with it produces the 10-binding shape both
   * rejected candidates came back with, and mutation control 29 exists to keep
   * it refused. So the runbook published, as the canonical upload, a command the
   * release tooling would have rejected outright, while §2 step 4 in the same
   * document printed the correct one — and the assertion that was supposed to
   * catch exactly that drift was pinning the wrong value.
   *
   * Deriving from `PRODUCTION_VERSION_UPLOAD_SPEC` means the runbook and the
   * argv the wrapper spawns cannot disagree without this failing.
   */
  it("publishes the canonical specification as data, DERIVED from it rather than retyped", () => {
    expect(runbook).toContain("PRODUCTION_VERSION_UPLOAD_SPEC");
    expect(runbook).toContain(
      PRODUCTION_VERSION_UPLOAD_SPEC.args.map((token) => `"${token}"`).join(", "),
    );
    // And the refused path is never published as the canonical one.
    expect(runbook).not.toContain(`"--config", "${GENERATED_WORKER_CONFIG_PATH}"`);
    expect(runbookFlat).toContain("derived from** that specification");
    expect(runbook).toContain("`shell: false`");
  });

  it("requires the exact supported Wrangler version and forbids a PATH fallback", () => {
    expect(runbookFlat).toContain("exact supported version");
    expect(runbookFlat).toContain("never falls back to a PATH lookup");
  });

  /**
   * FOREVER-PR140-FINAL-REVIEW-003 — the spawn gate names the marker the
   * preflight actually emits.
   *
   * §2b told the operator the wrapper refuses to spawn Wrangler "unless it
   * produced `PREUPLOAD_CONTRACT_OK`", and this assertion pinned that string.
   * That marker was superseded twice — once by the pinned-inheritance contract
   * and again by the explicit-binding contract — and §2 step 3 of the same
   * document already said it is never emitted again. The gate §2b described was
   * therefore unobservable: an operator watching for it would never see it, and
   * the assertion guarding the sentence was satisfied by the very words that
   * declare the marker dead.
   */
  it("names the CURRENT PREUPLOAD marker as the spawn gate, never a superseded one", () => {
    expect(runbook).toContain(PREUPLOAD_EXPLICIT_BINDINGS_MARKER);
    // A superseded marker may appear ONCE, and only after the sentence that
    // declares it superseded — never as an instruction to watch for it.
    const supersededNotice = runbook.indexOf("The superseded");
    expect(supersededNotice).toBeGreaterThan(-1);
    for (const superseded of SUPERSEDED_PREUPLOAD_MARKERS) {
      const occurrences = runbook.split(superseded).length - 1;
      expect(occurrences, superseded).toBe(1);
      expect(runbook.indexOf(superseded), superseded).toBeGreaterThan(supersededNotice);
    }
  });

  it("keeps every safety property the earlier corrections established", () => {
    expect(runbookFlat).toContain("a percentage rollout is PROHIBITED");
    expect(runbookFlat).toContain("Upload the candidate at 0% traffic");
    expect(runbookFlat).toContain("Obtain an explicit, short Owner Studio hold");
    expect(runbookFlat).toContain("Atomic cutover");
    expect(runbookFlat).toContain("Do not begin Coralina repair or any Retry in the release task");
  });

  it("renumbers the sequence consistently — no step points at a step that moved", () => {
    const sequence = runbook.slice(
      runbook.indexOf("## 2. The release sequence"),
      runbook.indexOf("## 2a."),
    );
    const numbers = [...sequence.matchAll(/^(\d+)\. \*\*/gm)].map((match) => Number(match[1]));
    expect(numbers).toEqual([...Array(18).keys()].map((index) => index + 1));
    // The upload is step 4, and every back-reference names step 4.
    expect(sequence).toContain("4. **Upload the candidate at 0% traffic");
    expect(runbook).not.toMatch(/UUID recorded in step 2\b/);
  });
});
