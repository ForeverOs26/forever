/**
 * SIP-001A - crash-recoverable, generation-transactional artifact output.
 *
 * The complete SIP directory is written and validated in a same-filesystem
 * staging directory, then swapped into the canonical `sip/` slot under the
 * existing per-project lock. A small journal makes a hard interruption
 * between the backup and install renames recoverable on the next run. No
 * caller can observe a mixed set of old and new SIP files.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { ExtractedPriceList } from "@/import/types";

import { atomicWriteJson, toCanonicalJson } from "../fs-utils";
import { removeManagedDir } from "../paths";
import { acquireProjectLock, releaseProjectLock } from "../txn";
import type { PreparationSummary, QualificationResult, ReviewSummary, SourceProof } from "./types";

const JOURNAL_FILENAME = ".sip-txn.json";

export interface SipArtifactPaths {
  source_proof: string;
  qualification: string;
  candidate_price_list: string;
  review_summary: string;
  preparation_summary: string;
  reviewed_price_list: string;
}

function pathsForDir(dir: string): SipArtifactPaths {
  return {
    source_proof: join(dir, "source-proof.json"),
    qualification: join(dir, "qualification.json"),
    candidate_price_list: join(dir, "candidate-price-list.json"),
    review_summary: join(dir, "review-summary.json"),
    preparation_summary: join(dir, "preparation-summary.json"),
    reviewed_price_list: join(dir, "reviewed-price-list.json"),
  };
}

export function sipArtifactPaths(outRoot: string, projectSlug: string): SipArtifactPaths {
  return pathsForDir(join(outRoot, projectSlug, "sip"));
}

/** Versioned SIP packages may choose a safe, project-contained artifact directory. */
export function sipArtifactPathsForDir(dir: string): SipArtifactPaths {
  return pathsForDir(dir);
}

export function sha256OfJson(value: unknown): string {
  return createHash("sha256").update(toCanonicalJson(value)).digest("hex");
}

export interface SipArtifactHooks {
  failAt?: "after-staging" | "after-backup" | "after-install";
  crashAt?: "after-backup" | "after-install";
}

export class SipArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SipArtifactError";
  }
}

export class SipCrashSimulation extends Error {
  constructor(point: string) {
    super(`sip_simulated_crash_at_${point}`);
    this.name = "SipCrashSimulation";
  }
}

interface SipJournal {
  sip_txn_version: "1";
  txn_id: string;
  phase: "staged" | "backed_up" | "installed" | "committed";
  staging_dir: string;
  canonical_dir: string;
  backup_dir: string;
  had_previous: boolean;
}

export interface WriteSipArtifactsInput {
  paths: SipArtifactPaths;
  sourceProof: SourceProof;
  qualification: QualificationResult;
  candidatePriceList: ExtractedPriceList;
  reviewSummary: ReviewSummary;
  preparationSummary: PreparationSummary;
  reviewedPriceList: ExtractedPriceList | null;
  hooks?: SipArtifactHooks;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

/** Positive proof that one directory contains exactly one internally bound generation. */
export function sipGenerationComplete(dir: string): boolean {
  const paths = pathsForDir(dir);
  const required = [
    paths.source_proof,
    paths.qualification,
    paths.candidate_price_list,
    paths.review_summary,
    paths.preparation_summary,
  ];
  if (required.some((path) => !existsSync(path))) return false;
  try {
    const source = readJson(paths.source_proof) as SourceProof;
    const qualification = readJson(paths.qualification) as QualificationResult;
    const candidate = readJson(paths.candidate_price_list) as ExtractedPriceList;
    const review = readJson(paths.review_summary) as ReviewSummary;
    const summary = readJson(paths.preparation_summary) as PreparationSummary;
    const reviewed = existsSync(paths.reviewed_price_list)
      ? (readJson(paths.reviewed_price_list) as ExtractedPriceList)
      : null;

    if (!summary.generation_id || !summary.source_pdf_sha256) return false;
    if (summary.source_pdf_sha256 !== source.sha256) return false;
    if (qualification.source_pdf_sha256 !== source.sha256) return false;
    if (source.generation_id !== summary.generation_id) return false;
    if (review.generation_id !== summary.generation_id) return false;
    if (review.source_pdf_sha256 !== source.sha256) return false;
    if (
      source.project_slug !== summary.project_slug ||
      review.project_slug !== summary.project_slug
    ) {
      return false;
    }
    if (summary.finalized !== Boolean(reviewed)) return false;
    if (summary.artifact_hashes.source_proof !== sha256OfJson(source)) return false;
    if (summary.artifact_hashes.qualification !== sha256OfJson(qualification)) return false;
    if (summary.artifact_hashes.candidate_price_list !== sha256OfJson(candidate)) return false;
    if (summary.artifact_hashes.review_summary !== sha256OfJson(review)) return false;
    if (reviewed && summary.artifact_hashes.reviewed_price_list !== sha256OfJson(reviewed)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function journalPath(projectDir: string): string {
  return join(projectDir, JOURNAL_FILENAME);
}

function readJournal(projectDir: string): SipJournal | "unreadable" | null {
  const path = journalPath(projectDir);
  if (!existsSync(path)) return null;
  try {
    const value = readJson(path) as SipJournal;
    if (
      value.sip_txn_version !== "1" ||
      !/^[A-Za-z0-9-]+$/.test(value.txn_id) ||
      !["staged", "backed_up", "installed", "committed"].includes(value.phase) ||
      typeof value.had_previous !== "boolean"
    ) {
      return "unreadable";
    }
    return value;
  } catch {
    return "unreadable";
  }
}

function assertTrustedJournal(projectDir: string, journal: SipJournal): void {
  const expected = {
    staging_dir: join(projectDir, `.sip-staging-${journal.txn_id}`),
    canonical_dir: join(projectDir, "sip"),
    backup_dir: join(projectDir, `sip.bak-${journal.txn_id}`),
  };
  for (const [field, path] of Object.entries(expected)) {
    if (resolve(journal[field as keyof typeof expected]) !== resolve(path)) {
      throw new SipArtifactError(`sip_recovery_untrusted_${field}`);
    }
  }
}

function restoreBackup(projectDir: string, backup: string, canonical: string): void {
  if (!sipGenerationComplete(backup)) {
    throw new SipArtifactError("sip_recovery_previous_generation_unverified");
  }
  if (existsSync(canonical)) removeManagedDir(canonical, [projectDir]);
  renameSync(backup, canonical);
}

/** Reconcile an interrupted prior SIP commit under the project lock. */
export function reconcileSipGeneration(projectDir: string): void {
  if (!existsSync(projectDir)) return;
  const names = readdirSync(projectDir);
  const stagings = names.filter((name) => name.startsWith(".sip-staging-"));
  const backups = names.filter((name) => name.startsWith("sip.bak-"));
  const canonical = join(projectDir, "sip");
  const journal = readJournal(projectDir);

  const cleanupStagings = (): void => {
    for (const name of stagings) removeManagedDir(join(projectDir, name), [projectDir]);
  };

  if (journal === "unreadable") {
    if (backups.length > 0) throw new SipArtifactError("sip_recovery_unreadable_with_backup");
    rmSync(journalPath(projectDir), { force: true });
    cleanupStagings();
    return;
  }

  if (journal) {
    assertTrustedJournal(projectDir, journal);
    const unexpected = backups.filter((name) => name !== `sip.bak-${journal.txn_id}`);
    if (unexpected.length > 0) throw new SipArtifactError("sip_recovery_ambiguous_backup");
    if (journal.phase === "committed" && sipGenerationComplete(canonical)) {
      if (existsSync(journal.backup_dir)) removeManagedDir(journal.backup_dir, [projectDir]);
    } else if (journal.had_previous) {
      const previous = existsSync(journal.backup_dir) ? journal.backup_dir : canonical;
      if (!sipGenerationComplete(previous)) {
        throw new SipArtifactError("sip_recovery_previous_generation_incomplete");
      }
      if (existsSync(journal.backup_dir)) restoreBackup(projectDir, journal.backup_dir, canonical);
    } else {
      if (existsSync(journal.backup_dir))
        throw new SipArtifactError("sip_recovery_unexpected_backup");
      if (existsSync(canonical)) removeManagedDir(canonical, [projectDir]);
    }
    cleanupStagings();
    rmSync(journalPath(projectDir), { force: true });
    return;
  }

  if (backups.length > 1) throw new SipArtifactError("sip_recovery_ambiguous_backup");
  if (backups.length === 1) {
    const backup = join(projectDir, backups[0]);
    if (sipGenerationComplete(canonical)) removeManagedDir(backup, [projectDir]);
    else restoreBackup(projectDir, backup, canonical);
  }
  cleanupStagings();
}

function hit(
  hooks: SipArtifactHooks | undefined,
  point: "after-staging" | "after-backup" | "after-install",
): void {
  if (hooks?.crashAt === point) throw new SipCrashSimulation(point);
  if (hooks?.failAt === point) throw new SipArtifactError(`sip_injected_failure_${point}`);
}

function writeGeneration(dir: string, input: WriteSipArtifactsInput): void {
  const paths = pathsForDir(dir);
  atomicWriteJson(paths.source_proof, input.sourceProof);
  atomicWriteJson(paths.qualification, input.qualification);
  atomicWriteJson(paths.candidate_price_list, input.candidatePriceList);
  atomicWriteJson(paths.review_summary, input.reviewSummary);
  atomicWriteJson(paths.preparation_summary, input.preparationSummary);
  if (input.reviewedPriceList) atomicWriteJson(paths.reviewed_price_list, input.reviewedPriceList);
  if (!sipGenerationComplete(dir)) throw new SipArtifactError("sip_staged_generation_incomplete");
}

/** Stage, validate, and atomically publish one complete SIP generation. */
export function writeSipArtifacts(input: WriteSipArtifactsInput): void {
  const canonicalDir = dirname(input.paths.source_proof);
  const projectDir = dirname(canonicalDir);
  mkdirSync(projectDir, { recursive: true });
  if (!acquireProjectLock(projectDir)) throw new SipArtifactError("sip_project_locked");
  const uid = randomUUID();
  const stagingDir = join(projectDir, `.sip-staging-${uid}`);
  const backupDir = join(projectDir, `sip.bak-${uid}`);
  const journal: SipJournal = {
    sip_txn_version: "1",
    txn_id: uid,
    phase: "staged",
    staging_dir: stagingDir,
    canonical_dir: canonicalDir,
    backup_dir: backupDir,
    had_previous: existsSync(canonicalDir),
  };
  const advance = (phase: SipJournal["phase"]): void => {
    journal.phase = phase;
    atomicWriteJson(journalPath(projectDir), journal);
  };

  try {
    reconcileSipGeneration(projectDir);
    journal.had_previous = existsSync(canonicalDir);
    writeGeneration(stagingDir, input);
    advance("staged");
    hit(input.hooks, "after-staging");
    if (journal.had_previous) renameSync(canonicalDir, backupDir);
    advance("backed_up");
    hit(input.hooks, "after-backup");
    renameSync(stagingDir, canonicalDir);
    advance("installed");
    hit(input.hooks, "after-install");
    if (!sipGenerationComplete(canonicalDir)) {
      throw new SipArtifactError("sip_installed_generation_incomplete");
    }
    advance("committed");
    if (existsSync(backupDir)) removeManagedDir(backupDir, [projectDir]);
    rmSync(journalPath(projectDir), { force: true });
  } catch (error) {
    if (error instanceof SipCrashSimulation) throw error;
    reconcileSipGeneration(projectDir);
    throw error;
  } finally {
    if (existsSync(stagingDir)) {
      try {
        removeManagedDir(stagingDir, [projectDir]);
      } catch {
        // A later run reconciles a managed residue under the same lock.
      }
    }
    releaseProjectLock(projectDir);
  }
}
