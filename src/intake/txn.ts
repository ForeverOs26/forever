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
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

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

const TXN_PHASES: ReadonlySet<string> = new Set([
  "validated",
  "intake_backed_up",
  "backed_up",
  "intake_installed",
  "progressive_installed",
  "committed",
]);

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
    if (
      parsed.intake_txn_version !== "1" ||
      typeof parsed.txn_id !== "string" ||
      !TXN_PHASES.has(parsed.phase) ||
      typeof parsed.staging_dir !== "string" ||
      typeof parsed.canonical_intake !== "string" ||
      typeof parsed.canonical_progressive !== "string" ||
      typeof parsed.backup_intake !== "string" ||
      typeof parsed.backup_progressive !== "string" ||
      typeof parsed.had_previous_intake !== "boolean" ||
      typeof parsed.had_previous_progressive !== "boolean" ||
      parsed.staged_validated !== true
    ) {
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
    const manifestPath = join(intakeDir, "source-manifest.json");
    const classificationPath = join(intakeDir, "classification.json");
    const factsPath = join(intakeDir, "extracted-facts.json");
    const payloadPath = join(progressiveDir, "payload.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    const classification = JSON.parse(readFileSync(classificationPath, "utf8")) as Record<
      string,
      unknown
    >;
    const facts = JSON.parse(readFileSync(factsPath, "utf8")) as Record<string, unknown>;
    const summary = JSON.parse(readFileSync(join(intakeDir, "intake-summary.json"), "utf8")) as {
      intake_schema_version?: unknown;
      project_slug?: unknown;
      project_name?: unknown;
      validation?: {
        fingerprint?: unknown;
        payload_sha256?: unknown;
        source_manifest_sha256?: unknown;
        classification_sha256?: unknown;
        extracted_facts_sha256?: unknown;
      };
    };
    const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as {
      batch_fingerprint?: unknown;
      project?: { slug?: unknown; name?: unknown };
    };
    const sha256 = (path: string): string =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    const slug = payload.project?.slug;
    return (
      manifest.intake_schema_version === "1" &&
      classification.intake_schema_version === "1" &&
      facts.intake_schema_version === "1" &&
      summary.intake_schema_version === "1" &&
      typeof slug === "string" &&
      slug.length > 0 &&
      manifest.project_slug === slug &&
      classification.project_slug === slug &&
      facts.project_slug === slug &&
      summary.project_slug === slug &&
      typeof payload.project?.name === "string" &&
      summary.project_name === payload.project.name &&
      typeof summary.validation?.fingerprint === "string" &&
      summary.validation.fingerprint.length > 0 &&
      summary.validation.fingerprint === payload.batch_fingerprint &&
      summary.validation.payload_sha256 === sha256(payloadPath) &&
      summary.validation.source_manifest_sha256 === sha256(manifestPath) &&
      summary.validation.classification_sha256 === sha256(classificationPath) &&
      summary.validation.extracted_facts_sha256 === sha256(factsPath)
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

function assertTrustedJournalPaths(projectDir: string, journal: TxnJournal): void {
  if (!/^[A-Za-z0-9-]+$/.test(journal.txn_id)) {
    throw new IntakeRecoveryError("intake_recovery_journal_paths_untrusted: invalid txn_id");
  }
  const expected = {
    staging_dir: join(projectDir, `.intake-staging-${journal.txn_id}`),
    canonical_intake: join(projectDir, "intake"),
    canonical_progressive: join(projectDir, "progressive"),
    backup_intake: join(projectDir, `intake.bak-${journal.txn_id}`),
    backup_progressive: join(projectDir, `progressive.bak-${journal.txn_id}`),
  };
  for (const [field, expectedPath] of Object.entries(expected)) {
    if (resolve(journal[field as keyof typeof expected] as string) !== resolve(expectedPath)) {
      throw new IntakeRecoveryError(
        `intake_recovery_journal_paths_untrusted: ${field} does not name its managed project path`,
      );
    }
  }
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
    assertTrustedJournalPaths(projectDir, journal);
    const backupIntake = journal.backup_intake;
    const backupProgressive = journal.backup_progressive;
    const expectedBackupNames = new Set([
      `intake.bak-${journal.txn_id}`,
      `progressive.bak-${journal.txn_id}`,
    ]);
    const unexpectedBackups = [...entries.backupIntakes, ...entries.backupProgressives].filter(
      (name) => !expectedBackupNames.has(name),
    );
    if (unexpectedBackups.length > 0) {
      throw new IntakeRecoveryError(
        "intake_recovery_ambiguous_backups: journal does not identify every managed backup. Inspect the project directory manually.",
      );
    }

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
        if (!generationComplete(canonicalIntake, canonicalProgressive)) {
          throw new IntakeRecoveryError(
            "intake_recovery_backup_restore_failed: restored committed fallback is incomplete",
          );
        }
        deleteStaging();
        removeJournal(projectDir);
        return { action: "restored_backup" };
      }
      throw new IntakeRecoveryError(
        "intake_recovery_committed_but_incomplete: neither the canonical set nor the backup set is a complete generation. Inspect the project directory manually.",
      );
    }

    // Every phase before `committed` rolls back. Before removing or replacing
    // either canonical slot, prove that the two old slots form one complete,
    // hash-bound generation. This prevents a partial or mixed backup from
    // destroying the only complete state.
    if (journal.had_previous_intake !== journal.had_previous_progressive) {
      throw new IntakeRecoveryError(
        "intake_recovery_previous_generation_incomplete: only one previous canonical slot was recorded",
      );
    }
    if (journal.had_previous_intake) {
      const oldIntake = existsSync(backupIntake) ? backupIntake : canonicalIntake;
      const oldProgressive = existsSync(backupProgressive)
        ? backupProgressive
        : canonicalProgressive;
      if (!generationComplete(oldIntake, oldProgressive)) {
        throw new IntakeRecoveryError(
          "intake_recovery_previous_generation_unverified: refusing to replace canonical slots with an incomplete or mixed backup",
        );
      }
      if (existsSync(backupIntake)) restoreSlot(projectDir, backupIntake, canonicalIntake);
      if (existsSync(backupProgressive)) {
        restoreSlot(projectDir, backupProgressive, canonicalProgressive);
      }
      if (!generationComplete(canonicalIntake, canonicalProgressive)) {
        throw new IntakeRecoveryError(
          "intake_recovery_previous_generation_restore_failed: restored generation is incomplete",
        );
      }
    } else {
      if (existsSync(backupIntake) || existsSync(backupProgressive)) {
        throw new IntakeRecoveryError(
          "intake_recovery_unexpected_backup: journal recorded no previous generation",
        );
      }
      if (existsSync(canonicalIntake)) removeManagedDir(canonicalIntake, [projectDir]);
      if (existsSync(canonicalProgressive)) removeManagedDir(canonicalProgressive, [projectDir]);
    }
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
  // exists. Prove the candidate pair is one complete generation BEFORE either
  // canonical slot is removed, then restore by rename.
  const backupIntake = entries.backupIntakes[0] ? join(projectDir, entries.backupIntakes[0]) : null;
  const backupProgressive = entries.backupProgressives[0]
    ? join(projectDir, entries.backupProgressives[0])
    : null;
  const oldIntake = backupIntake ?? canonicalIntake;
  const oldProgressive = backupProgressive ?? canonicalProgressive;
  if (!generationComplete(oldIntake, oldProgressive)) {
    throw new IntakeRecoveryError(
      "intake_recovery_backup_incomplete_or_mixed: no uniquely identifiable complete previous generation",
    );
  }
  if (backupIntake) restoreSlot(projectDir, backupIntake, canonicalIntake);
  if (backupProgressive) restoreSlot(projectDir, backupProgressive, canonicalProgressive);
  if (!generationComplete(canonicalIntake, canonicalProgressive)) {
    throw new IntakeRecoveryError(
      "intake_recovery_backup_restore_failed: restored generation is incomplete",
    );
  }
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
    if (!generationComplete(canonicalIntake, canonicalProgressive)) {
      throw new IntakeRecoveryError(
        "intake_commit_generation_incomplete: refusing to delete the previous generation",
      );
    }
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
  owner_token?: string;
}

const ownedLockTokens = new Map<string, string>();

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
  const ownerToken = randomUUID();
  const resolvedProjectDir = resolve(projectDir);
  const ownerKey =
    process.platform === "win32" ? resolvedProjectDir.toLowerCase() : resolvedProjectDir;
  const tryTake = (): boolean => {
    let created = false;
    try {
      mkdirSync(lockDir);
      created = true;
      atomicWriteJson(metaPath, {
        pid: process.pid,
        created_at: new Date().toISOString(),
        owner_token: ownerToken,
      });
      ownedLockTokens.set(ownerKey, ownerToken);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      if (created) {
        try {
          removeManagedDir(lockDir, [projectDir]);
        } catch {
          // Preserve the metadata-write error; the fresh meta-less lock will
          // fail closed and become age-reclaimable if cleanup itself failed.
        }
      }
      throw error;
    }
  };
  if (tryTake()) return true;

  // Contended: decide staleness from the recorded owner.
  let stale = false;
  let observedMeta: string | null = null;
  let observedMtime: number | null = null;
  try {
    observedMeta = readFileSync(metaPath, "utf8");
    const meta = JSON.parse(observedMeta) as LockMeta;
    stale = Number.isInteger(meta.pid) && !pidAlive(meta.pid);
  } catch {
    try {
      observedMtime = statSync(lockDir).mtimeMs;
      stale = Date.now() - observedMtime > STALE_LOCK_MS;
    } catch {
      // Lock vanished between checks; retry the take below.
      stale = true;
    }
  }
  if (!stale) return false;
  try {
    // Re-check the observed owner immediately before deletion. If another
    // process replaced or refreshed the lock, leave it untouched.
    if (observedMeta !== null && readFileSync(metaPath, "utf8") !== observedMeta) return false;
    if (
      observedMeta === null &&
      observedMtime !== null &&
      statSync(lockDir).mtimeMs !== observedMtime
    ) {
      return false;
    }
    removeManagedDir(join(projectDir, LOCK_DIRNAME), [projectDir]);
  } catch {
    return false;
  }
  return tryTake();
}

export function releaseProjectLock(projectDir: string): void {
  const resolvedProjectDir = resolve(projectDir);
  const ownerKey =
    process.platform === "win32" ? resolvedProjectDir.toLowerCase() : resolvedProjectDir;
  const ownerToken = ownedLockTokens.get(ownerKey);
  if (!ownerToken) return;
  try {
    const meta = JSON.parse(
      readFileSync(join(projectDir, LOCK_DIRNAME, "meta.json"), "utf8"),
    ) as LockMeta;
    if (meta.pid !== process.pid || meta.owner_token !== ownerToken) return;
    removeManagedDir(join(projectDir, LOCK_DIRNAME), [projectDir]);
  } catch {
    // Best effort; a leftover lock with a dead pid is reclaimed next run.
  } finally {
    ownedLockTokens.delete(ownerKey);
  }
}
