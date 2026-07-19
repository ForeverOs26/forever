/**
 * Fast Intake v1 — the orchestrator.
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
 * measured, never faked. Canonical outputs are written atomically and a failed
 * regeneration never replaces a previously valid payload.
 */

import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { join, resolve } from "node:path";

import { extractStructured } from "./extract";
import { atomicWriteJson, removeDirSafe } from "./fs-utils";
import { buildInventory } from "./inventory";
import { normalizeToBatch } from "./normalize";
import {
  DraftValidationError,
  validateDraftPayload,
  validateDraftPayloadFile,
} from "./validate-draft";
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

export interface RunIntakeOptions {
  projectSlug: string;
  projectName: string;
  sources: string[];
  outRoot?: string;
  workspaceRoot?: string;
  targetSeconds?: number;
  /** Injected wall-clock for a deterministic `intake_started_at` in tests. */
  now?: Date;
  /** Injected monotonic clock (ms) for deterministic elapsed in tests. */
  monotonic?: () => number;
  verbose?: boolean;
}

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

export async function runIntake(options: RunIntakeOptions): Promise<RunIntakeResult> {
  const monotonic = options.monotonic ?? (() => performance.now());
  const startedAtWall = (options.now ?? new Date()).toISOString();
  const start = monotonic();

  const outRoot = options.outRoot ?? DEFAULT_OUT_ROOT;
  const workspaceRoot = options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;
  const projectDir = join(outRoot, options.projectSlug);
  const intakeDir = join(projectDir, "intake");
  const progressiveDir = join(projectDir, "progressive");
  const artifacts: IntakeSummary["artifacts"] = {
    source_manifest: join(intakeDir, "source-manifest.json"),
    classification: join(intakeDir, "classification.json"),
    extracted_facts: join(intakeDir, "extracted-facts.json"),
    intake_summary: join(intakeDir, "intake-summary.json"),
    payload: join(progressiveDir, "payload.json"),
  };
  const workspaceDir = resolve(
    join(
      workspaceRoot,
      `${options.projectSlug}-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
    ),
  );

  const elapsed = () => {
    const ms = Math.max(0, monotonic() - start);
    const seconds = ms / 1000;
    return { ms, seconds };
  };

  try {
    // ---- Preparation phase: everything BEFORE any canonical write. ----------
    const inventory = buildInventory({
      projectSlug: options.projectSlug,
      sources: options.sources,
      workspaceDir,
      intakeStartedAt: startedAtWall,
    });
    const extraction = extractStructured(inventory.physicalFiles);

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

    // In-memory draft validation BEFORE writing anything: a build that cannot
    // pass the boundary must never touch a previously valid payload.
    validateDraftPayload(batch, "pending");

    // ---- Write phase: atomic; payload.json written last. --------------------
    atomicWriteJson(artifacts.source_manifest, inventory.manifest);
    atomicWriteJson(artifacts.classification, inventory.classification);
    atomicWriteJson(artifacts.extracted_facts, extractedFacts);
    atomicWriteJson(artifacts.payload, batch);

    // ---- Validate the written payload through the ordinary boundary. --------
    const validation = validateDraftPayloadFile(artifacts.payload);

    const intakeWarnings: IntakeWarning[] = [...inventory.intakeWarnings, ...extraction.warnings];
    const payloadWarnings = batch.warnings ?? [];
    const totalWarningSurface = intakeWarnings.length + payloadWarnings.length;
    const status: IntakeStatus =
      totalWarningSurface > 0 ? "PARTIAL_READY_WITH_WARNINGS" : "READY_FOR_DRAFT_IMPORT";

    const planned: PlannedGraphCounts = {
      projects: validation.counts.projects,
      buildings: validation.counts.buildings,
      units: validation.counts.units,
      prices: validation.counts.prices,
      media: validation.counts.media,
      warnings: validation.counts.warnings,
      batches: validation.counts.batches,
    };

    const { ms, seconds } = elapsed();
    const targetSeconds = options.targetSeconds ?? INTAKE_TARGET_SECONDS;
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

    atomicWriteJson(artifacts.intake_summary, summary);
    return { status, exitCode: 0, summary, wrotePayload: true, artifacts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { ms, seconds } = elapsed();
    const targetSeconds = options.targetSeconds ?? INTAKE_TARGET_SECONDS;
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

    // Preserve any previously valid payload and its summary: only write a
    // BLOCKED summary in place when there is no prior valid payload; otherwise
    // record the failure beside it without overwriting canonical output.
    const priorPayloadExists = existsSync(artifacts.payload);
    if (priorPayloadExists) {
      atomicWriteJson(join(intakeDir, "intake-failure.json"), summary);
    } else {
      atomicWriteJson(artifacts.intake_summary, summary);
    }

    const exitCode = error instanceof DraftValidationError ? 2 : 1;
    return { status: "BLOCKED", exitCode, summary, wrotePayload: false, artifacts };
  } finally {
    // Temporary extraction data is cleaned after success AND after failure.
    removeDirSafe(workspaceDir);
  }
}
