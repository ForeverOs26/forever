/**
 * Fast Intake v1 — recoverable artifact transactions.
 *
 * A commit replaces the canonical `intake/` and `progressive/` directories with
 * a staged, validated generation using same-filesystem renames. Every step is
 * recorded in a durable journal (`.intake-txn.json` in the project directory)
 * so that BOTH an in-process failure and a hard crash between renames are
 * deterministically recoverable on the next run:
 *
 *   validated → intake_backed_up → backed_up → intake_installed
 *             → progressive_installed → committed
 *
 * Only a transaction that reached `committed` keeps the new generation; every
 * earlier phase rolls back to the previous generation. A managed backup is
 * deleted only after positive evidence that the new canonical set is complete
 * and consistent and the transaction committed. The only complete surviving
 * generation is never deleted; irreconcilable states fail closed.
 *
 * A "complete generation" is the full five-artifact logical set
 * (intake/source-manifest.json, classification.json, extracted-facts.json,
 * intake-summary.json, progressive/payload.json) whose summary fingerprint
 * matches the payload's batch fingerprint.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

import { atomicWriteJson } from "./fs-utils";
import { IntakePathError, removeManagedDir } from "./paths";

export const JOURNAL_FILENAME = ".intake-txn.json";

/** Thrown when reconciliation cannot safely identify a complete generation. */
export class IntakeRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeRecoveryError";
  }
}

/** Thrown by test-only crash simulation: NO in-process rollback is performed. */
export class IntakeCrashSimulation extends Error {
  constructor(public readonly point: string) {
    super(`intake_simulated_crash_at_${point}`);
    this.name = "IntakeCrashSimulation";
  }
}

export type TxnPhase =
  | "validated"
  | "intake_backed_up"
  | "backed_up"
  | "intake_installed"
  | "progressive_installed"
  | "committed";

export interface TxnJournal {
  intake_txn_version: "1";
  txn_id: string;
  phase: TxnPhase;
  staging_dir: string;
  canonical_intake: string;
  canonical_progressive: string;
  backup_intake: string;
  backup_progressive: string;
  had_previous_intake: boolean;
  had_previous_progressive: boolean;
  staged_validated: boolean;
}

/** Filesystem transition points where tests may inject a failure or a crash. */
export type TxnFailpoint =
  | "before-backup-intake"
  | "after-backup-intake"
  | "before-backup-progressive"
  | "after-backup-progressive"
  | "before-install-intake"
  | "after-install-intake"
  | "before-install-progressive"
  | "after-install-progressive"
  | "before-mark-committed"
  | "after-mark-committed"
  | "before-delete-backup-intake"
  | "before-delete-backup-progressive"
  | "during-reconcile"
  | "during-staging-cleanup"
  | "during-backup-cleanup";

export interface TxnHooks {
  /** Throw an ordinary Error at this point (in-process failure; rollback runs). */
  failAt?: TxnFailpoint;
  /** Throw IntakeCrashSimulation at this point (NO rollback; state is left as-is). */
  crashAt?: TxnFailpoint;
}

function hit(hooks: TxnHooks | undefined, point: TxnFailpoint): void {
  if (hooks?.crashAt === point) throw new IntakeCrashSimulation(point);
  if (hooks?.failAt === point) throw new Error(`intake_injected_failure_at_${point}`);
}

export function journalPath(projectDir: string): string {
  return join(projectDir, JOURNAL_FILENAME);
}

export function readJournal(projectDir: string): TxnJournal | "unreadable" | null {
  const path = journalPath(projectDir);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as TxnJournal;
    if (parsed.intake_txn_version !== "1" || typeof parsed.txn_id !== "string" || !parsed.phase) {
      return "unreadable";
    }
    return parsed;
  } catch {
    return "unreadable";
  }
}

function writeJournal(projectDir: string, journal: TxnJournal): void {
  atomicWriteJson(journalPath(projectDir), journal);
}

function removeJournal(projectDir: string): void {
  rmSync(journalPath(projectDir), { force: true });
}

const GENERATION_FILES = {
  intake: [
    "source-manifest.json",
    "classification.json",
    "extracted-facts.json",
    "intake-summary.json",
  ],
  progressive: ["payload.json"],
} as const;

/**
 * A complete generation has all five artifacts AND a summary whose recorded
 * validation fingerprint matches the payload's batch fingerprint (same
 * transaction). Anything less is incomplete — including a mixed old/new set.
 */
export function generationComplete(intakeDir: string, progressiveDir: string): boolean {
  for (const name of GENERATION_FILES.intake) {
    if (!existsSync(join(intakeDir, name))) return false;
  }
  for (const name of GENERATION_FILES.progressive) {
    if (!existsSync(join(progressiveDir, name))) return false;
  }
  try {
    const summary = JSON.parse(readFileSync(join(intakeDir, "intake-summary.json"), "utf8")) as {
      validation?: { fingerprint?: string };
    };
    const payload = JSON.parse(readFileSync(join(progressiveDir, "payload.json"), "utf8")) as {
      batch_fingerprint?: string;
    };
    return (
      typeof summary.validation?.fingerprint === "string" &&
      summary.validation.fingerprint.length > 0 &&
      summary.validation.fingerprint === payload.batch_fingerprint
    );
  } catch {
    return false;
  }
}

/** Managed backup/staging names inside a project directory. */
function managedEntries(projectDir: string): {
  stagings: string[];
  backupIntakes: string[];
  backupProgressives: string[];
} {
  if (!existsSync(projectDir)) {
    return { stagings: [], backupIntakes: [], backupProgressives: [] };
  }
  const names = readdirSync(projectDir);
  return {
    stagings: names.filter((n) => n.startsWith(".intake-staging-")),
    backupIntakes: names.filter((n) => n.startsWith("intake.bak-")),
    backupProgressives: names.filter((n) => n.startsWith("progressive.bak-")),
  };
}

function restoreSlot(projectDir: string, backup: string, canonical: string): void {
  // Restore = rename the backup into the canonical slot. The backup is never
  // deleted first; a conflicting (partially installed) canonical dir is removed
  // only because the coherent prior state lives in the backup being restored.
  if (!existsSync(backup)) return;
  if (existsSync(canonical)) removeManagedDir(canonical, [projectDir]);
  renameSync(backup, canonical);
}

export interface ReconcileResult {
  action:
    | "none"
    | "cleaned_staging"
    | "rolled_back"
    | "finished_commit"
    | "restored_backup"
    | "removed_stale_journal";
}

/**
 * Startup reconciliation — runs under the per-project lock BEFORE a new intake
 * touches anything. Deterministically finishes or rolls back an interrupted
 * transaction, restores the previous generation where it is the only complete
 * one, and cleans managed staging/backup residue only when provably safe.
 * Fails closed (IntakeRecoveryError) when no complete generation can be
 * identified safely.
 */
export function reconcileProject(projectDir: string, hooks?: TxnHooks): ReconcileResult {
  hit(hooks, "during-reconcile");
  if (!existsSync(projectDir)) return { action: "none" };

  const canonicalIntake = join(projectDir, "intake");
  const canonicalProgressive = join(projectDir, "progressive");
  const journal = readJournal(projectDir);
  const entries = managedEntries(projectDir);

  const deleteStaging = (): void => {
    for (const name of entries.stagings) {
      hit(hooks, "during-staging-cleanup");
      removeManagedDir(join(projectDir, name), [projectDir]);
    }
  };
  const deleteBackups = (): void => {
    for (const name of [...entries.backupIntakes, ...entries.backupProgressives]) {
      hit(hooks, "during-backup-cleanup");
      removeManagedDir(join(projectDir, name), [projectDir]);
    }
  };

  if (journal === "unreadable") {
    // Case G: the journal cannot be trusted. Proceed only when the filesystem
    // alone is unambiguous (no managed backups to adjudicate).
    if (entries.backupIntakes.length === 0 && entries.backupProgressives.length === 0) {
      removeJournal(projectDir);
      deleteStaging();
      return { action: "removed_stale_journal" };
    }
    throw new IntakeRecoveryError(
      `intake_recovery_journal_unreadable: ${journalPath(projectDir)} — backups present; refusing to guess. Inspect the project directory manually.`,
    );
  }

  if (journal) {
    const backupIntake = journal.backup_intake;
    const backupProgressive = journal.backup_progressive;

    if (journal.phase === "committed") {
      // Case D: keep the new generation only when it is verifiably complete.
      if (generationComplete(canonicalIntake, canonicalProgressive)) {
        deleteBackups();
        deleteStaging();
        removeJournal(projectDir);
        return { action: "finished_commit" };
      }
      // Journal says committed but the canonical set is broken: restore the
      // previous generation if IT is complete; otherwise fail closed.
      if (
        existsSync(backupIntake) &&
        existsSync(backupProgressive) &&
        generationComplete(backupIntake, backupProgressive)
      ) {
        restoreSlot(projectDir, backupIntake, canonicalIntake);
        restoreSlot(projectDir, backupProgressive, canonicalProgressive);
        deleteStaging();
        removeJournal(projectDir);
        return { action: "restored_backup" };
      }
      throw new IntakeRecoveryError(
        "intake_recovery_committed_but_incomplete: neither the canonical set nor the backup set is a complete generation. Inspect the project directory manually.",
      );
    }

    // Every phase before `committed` rolls back to the previous generation.
    // Per-slot rule, safe for every crash window (the journal is written AFTER
    // each rename, so the filesystem may be one step ahead of the phase):
    //  - a backup exists            → the previous lives there: restore it
    //                                 (removing any staged-installed canonical);
    //  - no backup, had_previous    → the canonical slot still IS the previous:
    //                                 leave it untouched;
    //  - no backup, no previous     → any canonical content is staged-installed:
    //                                 remove it (roll back to nothing).
    const rollbackSlot = (backup: string, canonical: string, hadPrevious: boolean): void => {
      if (existsSync(backup)) {
        restoreSlot(projectDir, backup, canonical);
      } else if (!hadPrevious && existsSync(canonical)) {
        removeManagedDir(canonical, [projectDir]);
      }
    };
    rollbackSlot(backupIntake, canonicalIntake, journal.had_previous_intake);
    rollbackSlot(backupProgressive, canonicalProgressive, journal.had_previous_progressive);
    deleteStaging();
    removeJournal(projectDir);
    return { action: "rolled_back" };
  }

  // No journal. Decide from the filesystem alone.
  const hasBackups = entries.backupIntakes.length > 0 || entries.backupProgressives.length > 0;
  if (!hasBackups) {
    // Case A / E: canonical (whatever its state) is the only generation.
    deleteStaging();
    return entries.stagings.length ? { action: "cleaned_staging" } : { action: "none" };
  }
  if (entries.backupIntakes.length > 1 || entries.backupProgressives.length > 1) {
    throw new IntakeRecoveryError(
      "intake_recovery_ambiguous_backups: multiple managed backups for one slot. Inspect the project directory manually.",
    );
  }

  if (generationComplete(canonicalIntake, canonicalProgressive)) {
    // Case D (no journal survived): the canonical set is verifiably complete
    // and consistent — positive evidence the backups are superseded residue.
    deleteBackups();
    deleteStaging();
    return { action: "finished_commit" };
  }

  // Cases B, C, F: canonical is missing or incomplete and a managed backup
  // exists — the backup holds the previous generation. Restore it (never
  // deleting the backup first), then clean staging.
  const backupIntake = entries.backupIntakes[0] ? join(projectDir, entries.backupIntakes[0]) : null;
  const backupProgressive = entries.backupProgressives[0]
    ? join(projectDir, entries.backupProgressives[0])
    : null;
  if (backupIntake) restoreSlot(projectDir, backupIntake, canonicalIntake);
  if (backupProgressive) restoreSlot(projectDir, backupProgressive, canonicalProgressive);
  deleteStaging();
  return { action: "restored_backup" };
}

/**
 * Journaled atomic commit: back up the canonical directories, install the
 * staged ones, mark the transaction committed, then clean up. An in-process
 * failure before `committed` rolls back via the same reconciliation logic the
 * next run would use; a simulated crash leaves the state exactly as-is.
 */
export function commitArtifacts(
  stagingDir: string,
  projectDir: string,
  uid: string,
  hooks?: TxnHooks,
): void {
  const canonicalIntake = join(projectDir, "intake");
  const canonicalProgressive = join(projectDir, "progressive");
  const stagedIntake = join(stagingDir, "intake");
  const stagedProgressive = join(stagingDir, "progressive");
  const backupIntake = join(projectDir, `intake.bak-${uid}`);
  const backupProgressive = join(projectDir, `progressive.bak-${uid}`);

  const journal: TxnJournal = {
    intake_txn_version: "1",
    txn_id: uid,
    phase: "validated",
    staging_dir: stagingDir,
    canonical_intake: canonicalIntake,
    canonical_progressive: canonicalProgressive,
    backup_intake: backupIntake,
    backup_progressive: backupProgressive,
    had_previous_intake: existsSync(canonicalIntake),
    had_previous_progressive: existsSync(canonicalProgressive),
    staged_validated: true,
  };
  const advance = (phase: TxnPhase): void => {
    journal.phase = phase;
    writeJournal(projectDir, journal);
  };
  advance("validated");

  try {
    hit(hooks, "before-backup-intake");
    if (journal.had_previous_intake) renameSync(canonicalIntake, backupIntake);
    advance("intake_backed_up");
    hit(hooks, "after-backup-intake");

    hit(hooks, "before-backup-progressive");
    if (journal.had_previous_progressive) renameSync(canonicalProgressive, backupProgressive);
    advance("backed_up");
    hit(hooks, "after-backup-progressive");

    hit(hooks, "before-install-intake");
    renameSync(stagedIntake, canonicalIntake);
    advance("intake_installed");
    hit(hooks, "after-install-intake");

    hit(hooks, "before-install-progressive");
    renameSync(stagedProgressive, canonicalProgressive);
    advance("progressive_installed");
    hit(hooks, "after-install-progressive");

    hit(hooks, "before-mark-committed");
    advance("committed");
  } catch (error) {
    // A simulated crash leaves the mid-transaction state for the NEXT run's
    // reconciliation — exactly like a real process death between renames.
    if (error instanceof IntakeCrashSimulation) throw error;
    try {
      reconcileProject(projectDir);
    } catch (recoveryError) {
      if (
        recoveryError instanceof IntakePathError ||
        recoveryError instanceof IntakeRecoveryError
      ) {
        throw recoveryError;
      }
      throw error;
    }
    throw error;
  }

  // Committed: the new generation is canonical. Backup/journal cleanup is
  // best-effort — residue is finished safely by the next run's reconciliation.
  try {
    hit(hooks, "after-mark-committed");
    hit(hooks, "before-delete-backup-intake");
    if (existsSync(backupIntake)) removeManagedDir(backupIntake, [projectDir]);
    hit(hooks, "before-delete-backup-progressive");
    if (existsSync(backupProgressive)) removeManagedDir(backupProgressive, [projectDir]);
    removeJournal(projectDir);
  } catch (error) {
    if (error instanceof IntakeCrashSimulation) throw error;
    // Swallow: commit already succeeded; reconciliation cleans the residue.
  }
}

// ---------------------------------------------------------------------------
// Per-project lock with safe stale-lock reclaim
// ---------------------------------------------------------------------------

export const LOCK_DIRNAME = ".intake.lock";
/** A meta-less lock older than this is considered abandoned. */
export const STALE_LOCK_MS = 60 * 60 * 1000;

export interface LockMeta {
  pid: number;
  created_at: string;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Acquire the per-project lock via exclusive mkdir. A lock whose recorded
 * owner process is provably dead (or whose metadata is missing/unreadable and
 * the lock is older than STALE_LOCK_MS) is reclaimed once; a live owner wins.
 * Returns true when acquired; false when a live owner holds the lock.
 */
export function acquireProjectLock(projectDir: string): boolean {
  const lockDir = join(projectDir, LOCK_DIRNAME);
  const metaPath = join(lockDir, "meta.json");
  const tryTake = (): boolean => {
    try {
      mkdirSync(lockDir);
      atomicWriteJson(metaPath, { pid: process.pid, created_at: new Date().toISOString() });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  };
  if (tryTake()) return true;

  // Contended: decide staleness from the recorded owner.
  let stale = false;
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as LockMeta;
    stale = Number.isInteger(meta.pid) && !pidAlive(meta.pid);
  } catch {
    try {
      stale = Date.now() - statSync(lockDir).mtimeMs > STALE_LOCK_MS;
    } catch {
      // Lock vanished between checks; retry the take below.
      stale = true;
    }
  }
  if (!stale) return false;
  try {
    removeManagedDir(join(projectDir, LOCK_DIRNAME), [projectDir]);
  } catch {
    return false;
  }
  return tryTake();
}

export function releaseProjectLock(projectDir: string): void {
  try {
    removeManagedDir(join(projectDir, LOCK_DIRNAME), [projectDir]);
  } catch {
    // Best effort; a leftover lock with a dead pid is reclaimed next run.
  }
}
