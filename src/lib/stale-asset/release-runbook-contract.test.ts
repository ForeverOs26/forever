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
