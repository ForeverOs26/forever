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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const runbook = read("docs/FOREVER_PRODUCTION_RELEASE_RUNBOOK.md");
const contract = read("docs/FOREVER_STUDIO_STALE_ASSET_RECOVERY.md");

/** Markdown wraps; a safety statement must not depend on where a line broke. */
const flat = (text: string) => text.replace(/\s+/g, " ");
const runbookFlat = flat(runbook);
const contractFlat = flat(contract);

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
      "Enable and verify Workers Logs",
      "Owner Studio hold",
      "closes or refreshes the existing Studio tab",
      "Atomic cutover",
      "Verify public routes",
      "Verify the full current asset graph",
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
