import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { commitArtifacts, runIntake, type RunStage } from "../run";

const FIXTURE = resolve("src/intake/test-fixtures/sample-project");
const FIXED_NOW = new Date("2026-07-19T00:00:00.000Z");

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "intake-txn-"));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function copyFixture(name: string): string {
  const dest = join(base, name);
  cpSync(FIXTURE, dest, { recursive: true });
  return dest;
}
function run(options: Parameters<typeof runIntake>[0]) {
  return runIntake({
    outRoot: join(base, "out"),
    workspaceRoot: join(base, "ws"),
    now: FIXED_NOW,
    ...options,
  });
}
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  }) as unknown as Array<{ isFile(): boolean; parentPath: string; name: string }>) {
    if (entry.isFile()) {
      const full = join(entry.parentPath, entry.name);
      out[full.slice(dir.length)] = readFileSync(full, "utf8");
    }
  }
  return out;
}

describe("Fast Intake transactional output", () => {
  const stages: RunStage[] = [
    "inventory",
    "extraction",
    "normalization",
    "staging-write",
    "validation",
    "commit",
  ];

  for (const stage of stages) {
    it(`preserves the previous valid canonical set when failure is injected at "${stage}"`, async () => {
      const src = copyFixture("sample-project");
      const good = await run({ projectSlug: "keep", projectName: "Keep", sources: [src] });
      expect(good.status).not.toBe("BLOCKED");
      const projectDir = join(base, "out", "keep");
      const before = snapshot(projectDir);

      const bad = await run({
        projectSlug: "keep",
        projectName: "Keep",
        sources: [src],
        failAfter: stage,
      });
      expect(bad.status).toBe("BLOCKED");
      expect(bad.exitCode).not.toBe(0);

      // The canonical five-file set is byte-for-byte unchanged...
      const after = snapshot(projectDir);
      for (const key of Object.keys(before)) expect(after[key]).toBe(before[key]);
      // ...and no staging/lock/backup residue remains.
      const residue = readdirSync(projectDir).filter(
        (n) =>
          n.startsWith(".intake-staging-") ||
          n.startsWith("intake.bak-") ||
          n.startsWith("progressive.bak-") ||
          n === ".intake.lock",
      );
      expect(residue).toEqual([]);
    });
  }

  it("preserves the previous set when structured extraction fails (corrupt JSON)", async () => {
    const src = copyFixture("sample-project");
    const good = await run({ projectSlug: "corrupt", projectName: "Corrupt", sources: [src] });
    const payload = readFileSync(good.artifacts.payload, "utf8");
    // Corrupt the price-list so a re-run fails during structured extraction.
    writeFileSync(join(src, "price-list", "price-list.json"), "{ not valid json ");
    const bad = await run({ projectSlug: "corrupt", projectName: "Corrupt", sources: [src] });
    expect(bad.status).toBe("BLOCKED");
    expect(readFileSync(good.artifacts.payload, "utf8")).toBe(payload);
  });

  it("blocks and preserves the previous set on a duplicate-unit conflict", async () => {
    const src = copyFixture("sample-project");
    const good = await run({ projectSlug: "dupe", projectName: "Dupe", sources: [src] });
    const payload = readFileSync(good.artifacts.payload, "utf8");
    // Duplicate a unit identifier in the price list.
    const plPath = join(src, "price-list", "price-list.json");
    const pl = JSON.parse(readFileSync(plPath, "utf8"));
    pl.unit_inventory[1].unit_number.value = pl.unit_inventory[0].unit_number.value;
    writeFileSync(plPath, JSON.stringify(pl));
    const bad = await run({ projectSlug: "dupe", projectName: "Dupe", sources: [src] });
    expect(bad.status).toBe("BLOCKED");
    expect(bad.exitCode).toBe(3);
    expect(readFileSync(good.artifacts.payload, "utf8")).toBe(payload);
  });

  it("rolls back a partially applied commit, restoring the previous set", async () => {
    const src = copyFixture("rollback-source");
    const good = await run({ projectSlug: "rollback", projectName: "Rollback", sources: [src] });
    expect(good.exitCode).toBe(0);
    const projectDir = join(base, "out", "rollback");
    const before = snapshot(projectDir);

    // Staged set has intake/ but a MISSING progressive/, so the second rename fails.
    const stagingDir = join(projectDir, ".intake-staging-x");
    cpSync(join(projectDir, "intake"), join(stagingDir, "intake"), { recursive: true });

    expect(() => commitArtifacts(stagingDir, projectDir, "x")).toThrow();
    // The complete previous five-artifact generation is byte-for-byte restored.
    expect(snapshot(projectDir)).toEqual(before);
  });
});

describe("Fast Intake concurrency and stale cleanup", () => {
  it("blocks a second run for the same slug while a lock is held", async () => {
    const src = copyFixture("sample-project");
    const projectDir = join(base, "out", "locked");
    mkdirSync(join(projectDir, ".intake.lock"), { recursive: true });
    const result = await run({ projectSlug: "locked", projectName: "Locked", sources: [src] });
    expect(result.status).toBe("BLOCKED");
    expect(result.exitCode).toBe(4);
    expect(result.summary.validation.error).toContain("intake_locked");
    // The foreign lock is NOT removed by the blocked run.
    expect(existsSync(join(projectDir, ".intake.lock"))).toBe(true);
  });

  it("keeps different slugs independent under concurrent runs", async () => {
    const a = copyFixture("proj-a");
    const b = copyFixture("proj-b");
    const [ra, rb] = await Promise.all([
      run({ projectSlug: "aaa", projectName: "A", sources: [a] }),
      run({ projectSlug: "bbb", projectName: "B", sources: [b] }),
    ]);
    expect(ra.exitCode).toBe(0);
    expect(rb.exitCode).toBe(0);
  });

  it("removes stale staging/backup directories from a crashed prior run", async () => {
    const src = copyFixture("sample-project");
    const projectDir = join(base, "out", "stale");
    const first = await run({ projectSlug: "stale", projectName: "Stale", sources: [src] });
    expect(first.exitCode).toBe(0);
    mkdirSync(join(projectDir, ".intake-staging-old"), { recursive: true });
    mkdirSync(join(projectDir, "intake.bak-old"), { recursive: true });
    const result = await run({ projectSlug: "stale", projectName: "Stale", sources: [src] });
    expect(result.exitCode).toBe(0);
    const residue = readdirSync(projectDir).filter(
      (n) => n.includes(".bak-") || n.startsWith(".intake-staging-"),
    );
    expect(residue).toEqual([]);
  });
});
