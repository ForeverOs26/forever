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

import { check, resolveConfig } from "prettier";
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
      "Verify the deployed WORKER VERSION, by UUID",
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
      "Record the immutable Worker version UUID this upload returns, and require it to be NEW",
    );
    expect(runbookFlat).toContain(
      "Every authorized upload produces a new Worker version UUID, including an upload whose " +
        "client asset graph did not move",
    );
    expect(runbookFlat).toContain(
      "If the recorded candidate UUID equals the currently deployed one, no new Worker was " +
        "uploaded and the release STOPS",
    );
  });

  it("makes the deployed Worker version UUID the release gate, not the endpoint", () => {
    expect(runbookFlat).toContain("Verify the deployed WORKER VERSION, by UUID");
    expect(runbookFlat).toContain("This is the release gate");
    expect(runbookFlat).toContain(
      "This checks client asset compatibility, not the release",
    );
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
