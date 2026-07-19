import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runIntake } from "../run";
import {
  generationComplete,
  IntakeCrashSimulation,
  IntakeRecoveryError,
  JOURNAL_FILENAME,
  journalPath,
  LOCK_DIRNAME,
  reconcileProject,
  type TxnFailpoint,
} from "../txn";
import { atomicWriteJson } from "../fs-utils";

const FIXTURE = resolve("src/intake/test-fixtures/sample-project");
const FIXED_NOW = new Date("2026-07-19T00:00:00.000Z");
/** Far above any real pid on Linux/Windows — provably dead. */
const DEAD_PID = 2 ** 30 + 12345;

const FIVE = [
  join("intake", "source-manifest.json"),
  join("intake", "classification.json"),
  join("intake", "extracted-facts.json"),
  join("intake", "intake-summary.json"),
  join("progressive", "payload.json"),
];

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "intake-crash-"));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function copyFixture(name: string): string {
  const dest = join(base, name);
  cpSync(FIXTURE, dest, { recursive: true });
  return dest;
}

function run(options: Partial<Parameters<typeof runIntake>[0]> & { projectSlug: string }) {
  return runIntake({
    projectName: "Recovery",
    sources: [join(base, "src-fixture")],
    outRoot: join(base, "out"),
    workspaceRoot: join(base, "ws"),
    now: FIXED_NOW,
    ...options,
  });
}

/** SHA-256 of the five canonical artifacts. */
function hashes(projectDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of FIVE) {
    out[rel] = createHash("sha256")
      .update(readFileSync(join(projectDir, rel)))
      .digest("hex");
  }
  return out;
}

function residue(projectDir: string): string[] {
  return readdirSync(projectDir).filter(
    (n) =>
      n.startsWith(".intake-staging-") ||
      n.startsWith("intake.bak-") ||
      n.startsWith("progressive.bak-") ||
      n === JOURNAL_FILENAME ||
      n === LOCK_DIRNAME,
  );
}

/** Seed one valid canonical generation and return its hashes. */
async function seed(slug: string): Promise<{ projectDir: string; before: Record<string, string> }> {
  if (!existsSync(join(base, "src-fixture"))) copyFixture("src-fixture");
  const good = await run({ projectSlug: slug });
  expect(good.exitCode).toBe(0);
  const projectDir = join(base, "out", slug);
  return { projectDir, before: hashes(projectDir) };
}

/** Make the second run produce DIFFERENT content (so a commit really replaces). */
function mutateSource(): void {
  const facts = join(base, "src-fixture", "facts", "project-facts.json");
  const parsed = JSON.parse(readFileSync(facts, "utf8"));
  parsed.project_type.value = "Condominium";
  writeFileSync(facts, JSON.stringify(parsed, null, 2));
}

describe("in-process failure injection at every commit transition", () => {
  const ROLLBACK_POINTS: TxnFailpoint[] = [
    "before-backup-intake",
    "after-backup-intake",
    "before-backup-progressive",
    "after-backup-progressive",
    "before-install-intake",
    "after-install-intake",
    "before-install-progressive",
    "after-install-progressive",
    "before-mark-committed",
  ];
  for (const point of ROLLBACK_POINTS) {
    it(`failAt "${point}" → BLOCKED, previous five files byte-identical, no residue`, async () => {
      const { projectDir, before } = await seed(`fa-${point}`);
      mutateSource();
      const bad = await run({ projectSlug: `fa-${point}`, txnHooks: { failAt: point } });
      expect(bad.status).toBe("BLOCKED");
      expect(bad.exitCode).not.toBe(0);
      expect(hashes(projectDir)).toEqual(before);
      expect(residue(projectDir)).toEqual([]);
    });
  }

  const POST_COMMIT_POINTS: TxnFailpoint[] = [
    "after-mark-committed",
    "before-delete-backup-intake",
    "before-delete-backup-progressive",
  ];
  for (const point of POST_COMMIT_POINTS) {
    it(`failAt "${point}" → run still succeeds with the NEW generation; next run cleans residue`, async () => {
      const { projectDir, before } = await seed(`pc-${point}`);
      mutateSource();
      const result = await run({ projectSlug: `pc-${point}`, txnHooks: { failAt: point } });
      expect(result.exitCode).toBe(0);
      const after = hashes(projectDir);
      expect(after[join("progressive", "payload.json")]).not.toBe(
        before[join("progressive", "payload.json")],
      );
      expect(generationComplete(join(projectDir, "intake"), join(projectDir, "progressive"))).toBe(
        true,
      );
      // Residue (journal and/or backups) may remain — a later run reconciles it.
      const clean = await run({ projectSlug: `pc-${point}` });
      expect(clean.exitCode).toBe(0);
      expect(residue(projectDir)).toEqual([]);
      expect(generationComplete(join(projectDir, "intake"), join(projectDir, "progressive"))).toBe(
        true,
      );
    });
  }
});

describe("crash-like states (no in-process rollback) recovered by reconciliation", () => {
  const CRASH_POINTS: TxnFailpoint[] = [
    "after-backup-intake",
    "after-backup-progressive",
    "after-install-intake",
    "after-install-progressive",
    "before-mark-committed",
  ];
  for (const point of CRASH_POINTS) {
    it(`crashAt "${point}" → next reconciliation restores the previous generation byte-for-byte`, async () => {
      const { projectDir, before } = await seed(`cr-${point}`);
      mutateSource();
      await expect(
        run({ projectSlug: `cr-${point}`, txnHooks: { crashAt: point } }),
      ).rejects.toThrow(IntakeCrashSimulation);
      // The dead process left its lock; reclaim path is tested separately.
      rmSync(join(projectDir, LOCK_DIRNAME), { recursive: true, force: true });

      reconcileProject(projectDir);
      expect(hashes(projectDir)).toEqual(before);
      expect(residue(projectDir)).toEqual([]);
    });
  }

  it('crashAt "after-mark-committed" → reconciliation FINISHES the commit (new generation kept)', async () => {
    const { projectDir, before } = await seed("cr-committed");
    mutateSource();
    await expect(
      run({ projectSlug: "cr-committed", txnHooks: { crashAt: "after-mark-committed" } }),
    ).rejects.toThrow(IntakeCrashSimulation);
    rmSync(join(projectDir, LOCK_DIRNAME), { recursive: true, force: true });

    reconcileProject(projectDir);
    const after = hashes(projectDir);
    expect(after[join("progressive", "payload.json")]).not.toBe(
      before[join("progressive", "payload.json")],
    );
    expect(generationComplete(join(projectDir, "intake"), join(projectDir, "progressive"))).toBe(
      true,
    );
    expect(residue(projectDir)).toEqual([]);
  });

  it("a full fresh run after a crash reclaims the dead-pid lock and recovers by itself", async () => {
    const { projectDir } = await seed("cr-full");
    mutateSource();
    await expect(
      run({ projectSlug: "cr-full", txnHooks: { crashAt: "after-install-intake" } }),
    ).rejects.toThrow(IntakeCrashSimulation);
    // Simulate the crashed process being dead: its lock meta points to a pid
    // that no longer exists.
    atomicWriteJson(join(projectDir, LOCK_DIRNAME, "meta.json"), {
      pid: DEAD_PID,
      created_at: FIXED_NOW.toISOString(),
    });

    const recovered = await run({ projectSlug: "cr-full" });
    expect(recovered.exitCode).toBe(0);
    expect(residue(projectDir)).toEqual([]);
    expect(generationComplete(join(projectDir, "intake"), join(projectDir, "progressive"))).toBe(
      true,
    );
  });
});

describe("reconciliation failure injection", () => {
  it('failAt "during-reconcile" → BLOCKED, canonical untouched', async () => {
    const { projectDir, before } = await seed("rc-fail");
    const bad = await run({ projectSlug: "rc-fail", txnHooks: { failAt: "during-reconcile" } });
    expect(bad.status).toBe("BLOCKED");
    expect(hashes(projectDir)).toEqual(before);
  });

  it('failAt "during-staging-cleanup" → BLOCKED, stale staging preserved, canonical untouched', async () => {
    const { projectDir, before } = await seed("rc-staging");
    mkdirSync(join(projectDir, ".intake-staging-stale"), { recursive: true });
    const bad = await run({
      projectSlug: "rc-staging",
      txnHooks: { failAt: "during-staging-cleanup" },
    });
    expect(bad.status).toBe("BLOCKED");
    expect(hashes(projectDir)).toEqual(before);
    expect(existsSync(join(projectDir, ".intake-staging-stale"))).toBe(true);
    // A clean run reconciles it away.
    const clean = await run({ projectSlug: "rc-staging" });
    expect(clean.exitCode).toBe(0);
    expect(residue(projectDir)).toEqual([]);
  });

  it('failAt "during-backup-cleanup" → BLOCKED, backups and journal preserved', async () => {
    const { projectDir } = await seed("rc-backup");
    mutateSource();
    // Leave a committed transaction with backups + journal in place.
    const left = await run({
      projectSlug: "rc-backup",
      txnHooks: { failAt: "before-delete-backup-intake" },
    });
    expect(left.exitCode).toBe(0);
    expect(existsSync(journalPath(projectDir))).toBe(true);
    const backups = residue(projectDir).filter((n) => n.includes(".bak-"));
    expect(backups.length).toBeGreaterThan(0);

    const bad = await run({
      projectSlug: "rc-backup",
      txnHooks: { failAt: "during-backup-cleanup" },
    });
    expect(bad.status).toBe("BLOCKED");
    for (const name of backups) expect(existsSync(join(projectDir, name))).toBe(true);
    expect(existsSync(journalPath(projectDir))).toBe(true);

    const clean = await run({ projectSlug: "rc-backup" });
    expect(clean.exitCode).toBe(0);
    expect(residue(projectDir)).toEqual([]);
  });
});

describe("startup reconciliation cases (constructed filesystem states)", () => {
  it("Case B: canonical missing + complete managed backup → restored, backup not deleted first", async () => {
    const { projectDir, before } = await seed("case-b");
    renameSync(join(projectDir, "intake"), join(projectDir, "intake.bak-x"));
    renameSync(join(projectDir, "progressive"), join(projectDir, "progressive.bak-x"));
    reconcileProject(projectDir);
    expect(hashes(projectDir)).toEqual(before);
    expect(residue(projectDir)).toEqual([]);
  });

  it("Case C: one canonical dir + complete backup set → previous generation restored", async () => {
    const { projectDir, before } = await seed("case-c");
    // Simulate a half-installed state: intake was swapped, progressive was not.
    renameSync(join(projectDir, "intake"), join(projectDir, "intake.bak-x"));
    cpSync(join(projectDir, "progressive"), join(projectDir, "progressive.bak-x"), {
      recursive: true,
    });
    mkdirSync(join(projectDir, "intake"), { recursive: true });
    writeFileSync(join(projectDir, "intake", "intake-summary.json"), "{}");
    reconcileProject(projectDir);
    expect(hashes(projectDir)).toEqual(before);
    expect(residue(projectDir)).toEqual([]);
  });

  it("Case D: canonical complete + committed journal + backups → backups deleted, canonical kept", async () => {
    const { projectDir, before } = await seed("case-d");
    mkdirSync(join(projectDir, "intake.bak-x"), { recursive: true });
    mkdirSync(join(projectDir, "progressive.bak-x"), { recursive: true });
    atomicWriteJson(journalPath(projectDir), {
      intake_txn_version: "1",
      txn_id: "x",
      phase: "committed",
      staging_dir: join(projectDir, ".intake-staging-x"),
      canonical_intake: join(projectDir, "intake"),
      canonical_progressive: join(projectDir, "progressive"),
      backup_intake: join(projectDir, "intake.bak-x"),
      backup_progressive: join(projectDir, "progressive.bak-x"),
      had_previous_intake: true,
      had_previous_progressive: true,
      staged_validated: true,
    });
    reconcileProject(projectDir);
    expect(hashes(projectDir)).toEqual(before);
    expect(residue(projectDir)).toEqual([]);
  });

  it("Case E: staging exists + canonical intact → only the managed staging is deleted", async () => {
    const { projectDir, before } = await seed("case-e");
    mkdirSync(join(projectDir, ".intake-staging-old", "intake"), { recursive: true });
    reconcileProject(projectDir);
    expect(hashes(projectDir)).toEqual(before);
    expect(residue(projectDir)).toEqual([]);
  });

  it("Case F: staging + incomplete canonical + backups → restore first, then staging removed", async () => {
    const { projectDir, before } = await seed("case-f");
    renameSync(join(projectDir, "intake"), join(projectDir, "intake.bak-x"));
    renameSync(join(projectDir, "progressive"), join(projectDir, "progressive.bak-x"));
    mkdirSync(join(projectDir, ".intake-staging-old"), { recursive: true });
    mkdirSync(join(projectDir, "intake"), { recursive: true });
    writeFileSync(join(projectDir, "intake", "intake-summary.json"), "{}");
    reconcileProject(projectDir);
    expect(hashes(projectDir)).toEqual(before);
    expect(residue(projectDir)).toEqual([]);
  });

  it("Case G: unreadable journal with backups present → fail closed, nothing deleted", async () => {
    const { projectDir, before } = await seed("case-g");
    mkdirSync(join(projectDir, "intake.bak-x"), { recursive: true });
    writeFileSync(journalPath(projectDir), "{ not json");
    expect(() => reconcileProject(projectDir)).toThrow(IntakeRecoveryError);
    expect(hashes(projectDir)).toEqual(before);
    expect(existsSync(join(projectDir, "intake.bak-x"))).toBe(true);
    expect(existsSync(journalPath(projectDir))).toBe(true);
    // A full run reports the documented recovery exit code.
    const blocked = await run({ projectSlug: "case-g" });
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.exitCode).toBe(5);
  });

  it("Case G: ambiguous multiple backups for one slot → fail closed", async () => {
    const { projectDir } = await seed("case-g2");
    mkdirSync(join(projectDir, "intake.bak-1"), { recursive: true });
    mkdirSync(join(projectDir, "intake.bak-2"), { recursive: true });
    renameSync(join(projectDir, "progressive"), join(projectDir, "progressive.bak-1"));
    expect(() => reconcileProject(projectDir)).toThrow(IntakeRecoveryError);
    expect(existsSync(join(projectDir, "intake.bak-1"))).toBe(true);
    expect(existsSync(join(projectDir, "intake.bak-2"))).toBe(true);
  });

  it("never deletes the only complete generation: committed journal but broken canonical → backup restored", async () => {
    const { projectDir, before } = await seed("case-broken");
    // Move the WHOLE valid generation into backups; canonical becomes garbage.
    renameSync(join(projectDir, "intake"), join(projectDir, "intake.bak-x"));
    renameSync(join(projectDir, "progressive"), join(projectDir, "progressive.bak-x"));
    mkdirSync(join(projectDir, "intake"), { recursive: true });
    writeFileSync(join(projectDir, "intake", "intake-summary.json"), "{}");
    atomicWriteJson(journalPath(projectDir), {
      intake_txn_version: "1",
      txn_id: "x",
      phase: "committed",
      staging_dir: join(projectDir, ".intake-staging-x"),
      canonical_intake: join(projectDir, "intake"),
      canonical_progressive: join(projectDir, "progressive"),
      backup_intake: join(projectDir, "intake.bak-x"),
      backup_progressive: join(projectDir, "progressive.bak-x"),
      had_previous_intake: true,
      had_previous_progressive: true,
      staged_validated: true,
    });
    reconcileProject(projectDir);
    expect(hashes(projectDir)).toEqual(before);
    expect(residue(projectDir)).toEqual([]);
  });
});

describe("same-slug concurrency and stale locks", () => {
  it("a live lock blocks the loser without touching the winner's staging, journal, or backups", async () => {
    const { projectDir, before } = await seed("conc");
    // Winner state: live-pid lock + staging + journal + backup.
    mkdirSync(join(projectDir, LOCK_DIRNAME), { recursive: true });
    atomicWriteJson(join(projectDir, LOCK_DIRNAME, "meta.json"), {
      pid: process.pid,
      created_at: new Date().toISOString(),
    });
    mkdirSync(join(projectDir, ".intake-staging-winner"), { recursive: true });
    mkdirSync(join(projectDir, "intake.bak-winner"), { recursive: true });
    atomicWriteJson(journalPath(projectDir), {
      intake_txn_version: "1",
      txn_id: "winner",
      phase: "validated",
      staging_dir: join(projectDir, ".intake-staging-winner"),
      canonical_intake: join(projectDir, "intake"),
      canonical_progressive: join(projectDir, "progressive"),
      backup_intake: join(projectDir, "intake.bak-winner"),
      backup_progressive: join(projectDir, "progressive.bak-winner"),
      had_previous_intake: true,
      had_previous_progressive: true,
      staged_validated: true,
    });

    const loser = await run({ projectSlug: "conc" });
    expect(loser.status).toBe("BLOCKED");
    expect(loser.exitCode).toBe(4);
    expect(existsSync(join(projectDir, ".intake-staging-winner"))).toBe(true);
    expect(existsSync(join(projectDir, "intake.bak-winner"))).toBe(true);
    expect(existsSync(journalPath(projectDir))).toBe(true);
    expect(existsSync(join(projectDir, LOCK_DIRNAME))).toBe(true);
    expect(hashes(projectDir)).toEqual(before);
  });

  it("reclaims a lock whose recorded owner is provably dead", async () => {
    const { projectDir } = await seed("stale-pid");
    mkdirSync(join(projectDir, LOCK_DIRNAME), { recursive: true });
    atomicWriteJson(join(projectDir, LOCK_DIRNAME, "meta.json"), {
      pid: DEAD_PID,
      created_at: new Date().toISOString(),
    });
    const result = await run({ projectSlug: "stale-pid" });
    expect(result.exitCode).toBe(0);
    expect(residue(projectDir)).toEqual([]);
  });

  it("reclaims a meta-less lock only after the stale age threshold", async () => {
    const { projectDir } = await seed("stale-age");
    const lockDir = join(projectDir, LOCK_DIRNAME);
    mkdirSync(lockDir, { recursive: true });
    // Fresh meta-less lock: NOT reclaimed.
    const blocked = await run({ projectSlug: "stale-age" });
    expect(blocked.exitCode).toBe(4);
    // Age it past the threshold: reclaimed.
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(lockDir, old, old);
    const result = await run({ projectSlug: "stale-age" });
    expect(result.exitCode).toBe(0);
  });
});
