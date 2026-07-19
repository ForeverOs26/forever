/**
 * Fast Intake v1 — the transactional orchestrator.
 *
 *   source folder / ZIP archives
 *   → inventory + classification
 *   → structured-artifact extraction (reuse only)
 *   → normalized project facts (anti-fabrication)
 *   → Progressive payload (existing builder + fingerprint)
 *   → local draft-only validation (ordinary ValidateOnly boundary, ported)
 *   → concise readiness summary
 *
 * Local only. No browser, no Supabase credentials, no database client, no
 * network request, no production write, no publication. Elapsed time is
 * measured, never faked.
 *
 * Output is TRANSACTIONAL: every artifact is built in a unique staging
 * directory inside the destination, validated there, and only then swapped into
 * place atomically. A failure at any step removes the staging directory and
 * preserves the previous canonical set byte-for-byte. A per-project lock makes
 * two runs for the same slug safe; different slugs are independent.
 */

import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { join, resolve } from "node:path";

import { extractStructured } from "./extract";
import { atomicWriteJson } from "./fs-utils";
import { buildInventory } from "./inventory";
import { normalizeToBatch } from "./normalize";
import { assertPathBoundaries, assertSafeSlug, removeManagedDir } from "./paths";
import { IntakeConflictError } from "./sanitize";
import {
  DraftValidationError,
  validateDraftPayload,
  validateDraftPayloadFile,
} from "./validate-draft";
import type { ZipLimits } from "./zip";
import type {
  IntakeCategory,
  IntakeStatus,
  IntakeSummary,
  IntakeWarning,
  PlannedGraphCounts,
} from "./types";
import { INTAKE_CATEGORIES, INTAKE_SCHEMA_VERSION, INTAKE_TARGET_SECONDS } from "./types";

const DEFAULT_OUT_ROOT = "forever-data/projects";
const DEFAULT_WORKSPACE_ROOT = ".intake-workspace";
const MEDIA_CATEGORIES: ReadonlySet<IntakeCategory> = new Set(["photo", "video"]);
const DOCUMENT_CATEGORIES: ReadonlySet<IntakeCategory> = new Set([
  "brochure",
  "legal-document",
  "developer-profile",
  "payment-plan",
  "master-plan",
  "floor-plan",
  "unit-plan",
  "map-location",
  "furniture-package",
]);

/**
 * Payload warning codes that represent a substantive missing fact or conflict.
 * Their presence keeps a valid draft at PARTIAL rather than READY. Offline
 * dependency-link deferrals (`developer_unresolved`, `location_unresolved`) and
 * informational v1 notes (coordinates/construction/media/document) are NOT
 * substantive — they never demote a structurally complete draft.
 */
export const SUBSTANTIVE_WARNING_CODES: ReadonlySet<string> = new Set([
  "developer_missing",
  "location_missing",
  "country_missing",
  "country_malformed",
  "currency_unresolved",
  "currency_unsupported",
  "price_missing",
  "price_invalid",
  "unit_identifier_missing",
  "project_name_source_differs",
  "field_conflict",
  "price_list_unreadable",
  "project_facts_unreadable",
  "developer_ambiguous",
  "location_ambiguous",
  "developer_match_requires_confirmation",
  "location_match_requires_confirmation",
  "multiple_price-list",
  "multiple_project-facts",
]);

export class IntakeLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeLockError";
  }
}

export interface RunIntakeOptions {
  projectSlug: string;
  projectName: string;
  sources: string[];
  outRoot?: string;
  workspaceRoot?: string;
  targetSeconds?: number;
  zipLimits?: ZipLimits;
  /** Injected wall-clock for a deterministic `intake_started_at` in tests. */
  now?: Date;
  /** Injected monotonic clock (ms) for deterministic elapsed in tests. */
  monotonic?: () => number;
  /** Test-only hook to inject a failure at a named stage. */
  failAfter?: RunStage;
  verbose?: boolean;
}

export type RunStage =
  | "inventory"
  | "extraction"
  | "normalization"
  | "staging-write"
  | "validation"
  | "commit";

export interface RunIntakeResult {
  status: IntakeStatus;
  exitCode: number;
  summary: IntakeSummary;
  wrotePayload: boolean;
  artifacts: IntakeSummary["artifacts"];
}

function emptyCategoryCounts(): Record<IntakeCategory, number> {
  return Object.fromEntries(INTAKE_CATEGORIES.map((category) => [category, 0])) as Record<
    IntakeCategory,
    number
  >;
}

function validateOnlyCommand(slug: string): string {
  return `powershell -NoProfile -File scripts/import/Import-ForeverProjectDraft.ps1 -Project ${slug} -ValidateOnly`;
}

export function importCommand(): string {
  return 'Double-click "Import Forever Project Draft.cmd" (or run scripts/import/Start-ForeverProjectDraftImport.ps1) and enter the database password once — a separately authorized action.';
}

/** Decide the readiness status from validation, graph shape, and warnings. */
export function classifyReadiness(input: {
  counts: PlannedGraphCounts;
  payloadWarningCodes: string[];
}): IntakeStatus {
  const meaningful =
    input.counts.buildings >= 1 && input.counts.units >= 1 && input.counts.prices >= 1;
  const substantive = input.payloadWarningCodes.some((code) => SUBSTANTIVE_WARNING_CODES.has(code));
  return meaningful && !substantive ? "READY_FOR_DRAFT_IMPORT" : "PARTIAL_READY_WITH_WARNINGS";
}

function throwIfFailStage(options: RunIntakeOptions, stage: RunStage): void {
  if (options.failAfter === stage) {
    throw new Error(`intake_injected_failure_at_${stage}`);
  }
}

/** Remove leftover staging / backup directories from a crashed prior run. */
function cleanupStaleArtifacts(projectDir: string): void {
  if (!existsSync(projectDir)) return;
  for (const name of readdirSync(projectDir)) {
    if (
      name.startsWith(".intake-staging-") ||
      name.startsWith("intake.bak-") ||
      name.startsWith("progressive.bak-")
    ) {
      try {
        removeManagedDir(join(projectDir, name), [projectDir]);
      } catch {
        // Never let stale-cleanup abort a run.
      }
    }
  }
}

/**
 * Atomically replace the canonical `intake/` and `progressive/` directories with
 * the staged ones, using same-filesystem renames and a backup-and-restore
 * rollback so a failure preserves the previous set byte-for-byte.
 */
export function commitArtifacts(stagingDir: string, projectDir: string, uid: string): void {
  const canonicalIntake = join(projectDir, "intake");
  const canonicalProgressive = join(projectDir, "progressive");
  const stagedIntake = join(stagingDir, "intake");
  const stagedProgressive = join(stagingDir, "progressive");
  const backupIntake = join(projectDir, `intake.bak-${uid}`);
  const backupProgressive = join(projectDir, `progressive.bak-${uid}`);

  const restores: Array<[string, string]> = [];
  const placed: string[] = [];
  try {
    if (existsSync(canonicalIntake)) {
      renameSync(canonicalIntake, backupIntake);
      restores.push([backupIntake, canonicalIntake]);
    }
    if (existsSync(canonicalProgressive)) {
      renameSync(canonicalProgressive, backupProgressive);
      restores.push([backupProgressive, canonicalProgressive]);
    }
    renameSync(stagedIntake, canonicalIntake);
    placed.push(canonicalIntake);
    renameSync(stagedProgressive, canonicalProgressive);
    placed.push(canonicalProgressive);
  } catch (error) {
    // Roll back: remove anything we placed, then restore the backups.
    for (const dir of placed) {
      try {
        removeManagedDir(dir, [projectDir]);
      } catch {
        /* best effort */
      }
    }
    for (const [backup, original] of restores) {
      if (existsSync(original)) {
        try {
          removeManagedDir(original, [projectDir]);
        } catch {
          /* best effort */
        }
      }
      renameSync(backup, original);
    }
    throw error;
  }
  // Success: drop the backups.
  for (const [backup] of restores) {
    try {
      removeManagedDir(backup, [projectDir]);
    } catch {
      /* best effort */
    }
  }
}

export async function runIntake(options: RunIntakeOptions): Promise<RunIntakeResult> {
  const monotonic = options.monotonic ?? (() => performance.now());
  const startedAtWall = (options.now ?? new Date()).toISOString();
  const start = monotonic();
  const uid = `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

  const outRoot = options.outRoot ?? DEFAULT_OUT_ROOT;
  const workspaceRoot = options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;
  const projectDir = resolve(join(outRoot, options.projectSlug));
  const intakeDir = join(projectDir, "intake");
  const progressiveDir = join(projectDir, "progressive");
  const artifacts: IntakeSummary["artifacts"] = {
    source_manifest: join(intakeDir, "source-manifest.json"),
    classification: join(intakeDir, "classification.json"),
    extracted_facts: join(intakeDir, "extracted-facts.json"),
    intake_summary: join(intakeDir, "intake-summary.json"),
    payload: join(progressiveDir, "payload.json"),
  };
  const workspaceDir = resolve(join(workspaceRoot, `${options.projectSlug}-${uid}`));
  const stagingDir = join(projectDir, `.intake-staging-${uid}`);
  const lockDir = join(projectDir, ".intake.lock");

  const elapsed = () => {
    const ms = Math.max(0, monotonic() - start);
    return { ms, seconds: ms / 1000 };
  };
  const targetSeconds = options.targetSeconds ?? INTAKE_TARGET_SECONDS;

  let lockAcquired = false;
  try {
    // Fail closed on unsafe slug / path overlaps BEFORE creating anything.
    assertSafeSlug(options.projectSlug);
    assertPathBoundaries({ outRoot, projectDir, workspaceDir, sources: options.sources });

    mkdirSync(projectDir, { recursive: true });
    try {
      mkdirSync(lockDir); // exclusive: fails if a concurrent run holds it
      lockAcquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new IntakeLockError(
          `intake_locked: another run for "${options.projectSlug}" is active`,
        );
      }
      throw error;
    }
    cleanupStaleArtifacts(projectDir);

    // ---- Preparation: everything in memory / staging, canonical untouched. ---
    const inventory = buildInventory({
      projectSlug: options.projectSlug,
      sources: options.sources,
      workspaceDir,
      intakeStartedAt: startedAtWall,
      zipLimits: options.zipLimits,
    });
    throwIfFailStage(options, "inventory");

    const extraction = extractStructured(inventory.physicalFiles);
    throwIfFailStage(options, "extraction");

    const hasMedia = inventory.physicalFiles.some((file) => MEDIA_CATEGORIES.has(file.category));
    const hasDocuments = inventory.physicalFiles.some((file) =>
      DOCUMENT_CATEGORIES.has(file.category),
    );

    const { batch, extractedFacts } = await normalizeToBatch({
      projectSlug: options.projectSlug,
      projectName: options.projectName,
      facts: extraction.facts,
      priceList: extraction.priceList,
      categoryFlags: {
        hasMedia,
        hasDocuments,
        priceListLogicalPath: extraction.priceListLogicalPath,
      },
    });
    throwIfFailStage(options, "normalization");

    // In-memory draft validation BEFORE writing anything.
    validateDraftPayload(batch, "pending");

    // ---- Staging write (inside the destination, canonical untouched). --------
    const staged = {
      source_manifest: join(stagingDir, "intake", "source-manifest.json"),
      classification: join(stagingDir, "intake", "classification.json"),
      extracted_facts: join(stagingDir, "intake", "extracted-facts.json"),
      intake_summary: join(stagingDir, "intake", "intake-summary.json"),
      payload: join(stagingDir, "progressive", "payload.json"),
    };
    atomicWriteJson(staged.source_manifest, inventory.manifest);
    atomicWriteJson(staged.classification, inventory.classification);
    atomicWriteJson(staged.extracted_facts, extractedFacts);
    atomicWriteJson(staged.payload, batch);
    throwIfFailStage(options, "staging-write");

    // Validate the staged payload through the ordinary boundary.
    const validation = validateDraftPayloadFile(staged.payload);
    throwIfFailStage(options, "validation");

    const intakeWarnings: IntakeWarning[] = [...inventory.intakeWarnings, ...extraction.warnings];
    const payloadWarningCodes = (batch.warnings ?? []).map((warning) => warning.code);
    const planned: PlannedGraphCounts = {
      projects: validation.counts.projects,
      buildings: validation.counts.buildings,
      units: validation.counts.units,
      prices: validation.counts.prices,
      media: validation.counts.media,
      warnings: validation.counts.warnings,
      batches: validation.counts.batches,
    };
    const status = classifyReadiness({ counts: planned, payloadWarningCodes });

    const { ms, seconds } = elapsed();
    const summary: IntakeSummary = {
      intake_schema_version: INTAKE_SCHEMA_VERSION,
      status,
      project_slug: options.projectSlug,
      project_name: batch.project.name ?? options.projectName,
      elapsed_ms: Math.round(ms),
      elapsed_seconds: Number(seconds.toFixed(3)),
      target_seconds: targetSeconds,
      target_met: seconds <= targetSeconds,
      source_file_count: inventory.manifest.file_count,
      duplicate_count: inventory.manifest.duplicate_count,
      classified_counts: inventory.classification.category_counts,
      extracted_fact_counts: extractedFacts.counts,
      planned_graph_counts: planned,
      validation: {
        ok: true,
        fingerprint: validation.fingerprint,
        fingerprint_verified: validation.fingerprintVerified,
        payload_sha256: validation.payloadSha256,
        marker: validation.marker,
        error: null,
      },
      blocking_issues: [],
      warnings: intakeWarnings,
      unsupported_files: inventory.physicalFiles
        .filter((file) => file.category === "unknown")
        .map((file) => file.logicalPath),
      artifacts,
      next_command: validateOnlyCommand(options.projectSlug),
    };
    atomicWriteJson(staged.intake_summary, summary);

    // ---- Commit: atomic swap of the whole set. ------------------------------
    throwIfFailStage(options, "commit");
    commitArtifacts(stagingDir, projectDir, uid);

    return { status, exitCode: 0, summary, wrotePayload: true, artifacts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { ms, seconds } = elapsed();
    const summary: IntakeSummary = {
      intake_schema_version: INTAKE_SCHEMA_VERSION,
      status: "BLOCKED",
      project_slug: options.projectSlug,
      project_name: options.projectName,
      elapsed_ms: Math.round(ms),
      elapsed_seconds: Number(seconds.toFixed(3)),
      target_seconds: targetSeconds,
      target_met: seconds <= targetSeconds,
      source_file_count: 0,
      duplicate_count: 0,
      classified_counts: emptyCategoryCounts(),
      extracted_fact_counts: { buildings: 0, units: 0, prices: 0 },
      planned_graph_counts: {
        projects: 0,
        buildings: 0,
        units: 0,
        prices: 0,
        media: 0,
        warnings: 0,
        batches: 0,
      },
      validation: {
        ok: false,
        fingerprint: "",
        fingerprint_verified: false,
        payload_sha256: "",
        marker: "",
        error: message,
      },
      blocking_issues: [message],
      warnings: [],
      unsupported_files: [],
      artifacts,
      next_command: validateOnlyCommand(options.projectSlug),
    };

    // Canonical output was never touched (only staging was written, and it is
    // removed below). Record the failure without replacing a valid set: beside
    // an existing valid payload as intake-failure.json, otherwise as the
    // first-run BLOCKED summary. A lock-blocked run writes NOTHING into the
    // canonical directories — another run owns them right now; the terminal
    // summary and exit code 4 are its record.
    if (!(error instanceof IntakeLockError)) {
      try {
        if (existsSync(artifacts.payload)) {
          atomicWriteJson(join(intakeDir, "intake-failure.json"), summary);
        } else {
          atomicWriteJson(artifacts.intake_summary, summary);
        }
      } catch {
        // Never let failure-record writing mask the original error.
      }
    }

    const exitCode =
      error instanceof DraftValidationError
        ? 2
        : error instanceof IntakeConflictError
          ? 3
          : error instanceof IntakeLockError
            ? 4
            : 1;
    return { status: "BLOCKED", exitCode, summary, wrotePayload: false, artifacts };
  } finally {
    // Remove temporary staging + workspace, then release the lock. Each guard
    // confines removal to its managed tree.
    try {
      removeManagedDir(stagingDir, [projectDir]);
    } catch {
      /* staging may never have been created */
    }
    try {
      removeManagedDir(workspaceDir, [resolve(workspaceRoot)]);
    } catch {
      // The workspace is always constructed strictly inside workspaceRoot, so a
      // containment failure here means it was never created; never fall back to
      // an unguarded remover.
    }
    if (lockAcquired) {
      try {
        removeManagedDir(lockDir, [projectDir]);
      } catch {
        /* best effort */
      }
    }
  }
}
