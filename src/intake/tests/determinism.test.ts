import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runIntake } from "../run";

const FIXTURE = resolve("src/intake/test-fixtures/sample-project");
const FIXED_NOW = new Date("2026-07-19T00:00:00.000Z");

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "intake-det-"));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function runAt(location: string, outName: string) {
  const src = join(base, location);
  cpSync(FIXTURE, src, { recursive: true });
  return runIntake({
    projectSlug: "det",
    projectName: "Det",
    sources: [src],
    outRoot: join(base, outName),
    workspaceRoot: join(base, `${outName}-ws`),
    now: FIXED_NOW,
  });
}
const read = (p: string) => readFileSync(p, "utf8");

describe("Fast Intake determinism (honest)", () => {
  it("payload, fingerprint, extracted-facts, and classification are byte-identical across absolute locations", async () => {
    const a = await runAt("alpha", "outA");
    const b = await runAt("deep/nested/beta", "outB");

    // Deterministic artifacts: byte-for-byte identical regardless of location.
    expect(read(b.artifacts.payload)).toBe(read(a.artifacts.payload));
    expect(b.summary.validation.fingerprint).toBe(a.summary.validation.fingerprint);
    expect(read(b.artifacts.extracted_facts)).toBe(read(a.artifacts.extracted_facts));
    expect(read(b.artifacts.classification)).toBe(read(a.artifacts.classification));

    // The source manifest's logical inventory is identical; only the
    // operational, local-only absolute path differs between the two runs.
    const ma = JSON.parse(read(a.artifacts.source_manifest));
    const mb = JSON.parse(read(b.artifacts.source_manifest));
    expect(mb.files).toEqual(ma.files);
    expect(mb.source_roots[0].local_only_path).not.toBe(ma.source_roots[0].local_only_path);
  });

  it("summary carries operational metadata (elapsed) that is not claimed deterministic", async () => {
    const a = await runAt("one", "o1");
    expect(typeof a.summary.elapsed_ms).toBe("number");
    expect(typeof a.summary.elapsed_seconds).toBe("number");
    // intake_started_at is operational; it is pinned only because tests inject a clock.
    const manifest = JSON.parse(read(a.artifacts.source_manifest));
    expect(manifest.intake_started_at).toBe(FIXED_NOW.toISOString());
  });
});
