/**
 * SIP-001A — the extraction orchestrator.
 *
 *   authorized raw PDF path
 *   → source proof (hash/size, no read of PDF bytes beyond hashing)
 *   → local Poppler preflight
 *   → pdftotext -layout invocation (bounded time/size, gitignored workspace)
 *   → text-layer qualification
 *   → deterministic table extraction (one supported layout)
 *   → candidate normalization (no fabrication)
 *   → exception-only review summary
 *   → finalized deterministic JSON (only when no blocking issue remains)
 *
 * This module NEVER reads the manually reviewed ground-truth comparison
 * JSON. That file is read only by the separate `compare.ts` module, after
 * this orchestrator has already fixed its output. No database client, no
 * network request, no import, no publication — only local generated
 * artifacts under `forever-data/projects/<slug>/sip/`.
 */

import { existsSync, statSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";

import type { ExtractedPriceList } from "@/import/types";

import { assertPathBoundaries, assertSafeSlug, isStrictlyInside, removeManagedDir } from "../paths";
import { sanitizePriceList } from "../sanitize";
import {
  sipArtifactPaths,
  sipArtifactPathsForDir,
  sha256OfJson,
  writeSipArtifacts,
  type SipArtifactHooks,
} from "./artifacts";
import {
  buildPriceListCandidates,
  buildReviewedPriceList,
  extractPriceListDate,
  extractSupplementalFees,
  resetReviewIdCounter,
} from "./candidate-normalize";
import { PdfToolError, preflightPdftotext, runPdftotextLayout } from "./pdf-tool";
import { qualifyPdfText } from "./pdf-qualify";
import { extractDocumentTables, mergeLayoutCoreCells } from "./price-table";
import { buildReviewSummary, canFinalize } from "./review";
import { assertSourceUnchanged, fingerprintSourceFile } from "./source-integrity";
import type {
  PdfToolPreflight,
  PreparationSummary,
  QualificationResult,
  ReviewItem,
  SourceProof,
} from "./types";
import { SIP_SCHEMA_VERSION } from "./types";

const DEFAULT_OUT_ROOT = "forever-data/projects";
const DEFAULT_WORKSPACE_ROOT = ".sip-workspace";

export class SipInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SipInputError";
  }
}

export interface RunSipOptions {
  projectSlug: string;
  pdfPath: string;
  outRoot?: string;
  workspaceRoot?: string;
  /** Optional versioned, project-contained artifact directory. */
  artifactDir?: string;
  /** Test-only generation-transaction failpoints. */
  artifactHooks?: SipArtifactHooks;
  /** Test-only preflight injection; the CLI never exposes this. */
  toolOverride?: PdfToolPreflight;
}

export interface RunSipResult {
  qualification: QualificationResult;
  sourceProof: SourceProof;
  candidatePriceList: ExtractedPriceList;
  reviewItems: ReviewItem[];
  reviewedPriceList: ExtractedPriceList | null;
  preparationSummary: PreparationSummary;
  paths: ReturnType<typeof sipArtifactPaths>;
}

function emptyQualification(reason: string): QualificationResult {
  return {
    status: "TOOL_FAILURE",
    reasons: [reason],
    pageCount: 0,
    nonWhitespaceCharCount: 0,
    headerMappings: [],
  };
}

export function runSipPriceListExtraction(options: RunSipOptions): RunSipResult {
  resetReviewIdCounter();
  assertSafeSlug(options.projectSlug);

  const pdfPath = resolve(options.pdfPath);
  if (!existsSync(pdfPath) || !statSync(pdfPath).isFile()) {
    throw new SipInputError(`sip_pdf_not_found: ${options.pdfPath}`);
  }
  if (extname(pdfPath).toLowerCase() !== ".pdf") {
    throw new SipInputError(`sip_pdf_extension_required: ${options.pdfPath}`);
  }

  const outRoot = options.outRoot ?? DEFAULT_OUT_ROOT;
  const workspaceRoot = options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;
  const projectDir = resolve(outRoot, options.projectSlug);
  const workspaceDir = resolve(
    workspaceRoot,
    `${options.projectSlug}-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
  );
  assertPathBoundaries({
    outRoot: resolve(outRoot),
    projectDir,
    workspaceDir,
    // Treat the authorized PDF's containing directory as the protected source
    // boundary so no temporary or canonical output can be written beside it.
    sources: [dirname(pdfPath)],
  });
  const artifactDir = options.artifactDir ? resolve(options.artifactDir) : null;
  if (artifactDir && !isStrictlyInside(artifactDir, projectDir)) {
    throw new SipInputError("sip_artifact_dir_escapes_project_dir");
  }

  const sourcePreProcessing = fingerprintSourceFile(pdfPath);
  const sourceFilename = basename(pdfPath);
  let sourceProof: SourceProof = {
    sip_schema_version: SIP_SCHEMA_VERSION,
    project_slug: options.projectSlug,
    source_filename: sourceFilename,
    sha256: sourcePreProcessing.sha256,
    byte_size: sourcePreProcessing.byte_size,
    pre_processing: sourcePreProcessing,
    // This temporary value is never emitted: any outcome writes artifacts only
    // after the post-processing comparison below has succeeded.
    post_processing: sourcePreProcessing,
    hash_verified_unchanged_after_extraction: false,
  };

  const tool = options.toolOverride ?? preflightPdftotext();
  const reviewItems: ReviewItem[] = [];
  const blockingIssues: string[] = [];
  let qualification: QualificationResult;
  let candidatePriceList: ExtractedPriceList = { unit_inventory: [] };
  let supplementalFees: PreparationSummary["supplemental_fees"];

  if (!tool.found) {
    qualification = emptyQualification(tool.error ?? "pdftotext_not_available");
    blockingIssues.push(
      "BLOCKED — AUTHORIZED PDF TEXT TOOL REQUIRED: pdftotext was not found on this machine.",
    );
  } else {
    try {
      const layoutExtraction = runPdftotextLayout({
        tool,
        pdfPath,
        workspaceDir,
        mode: "layout",
      });
      let parserExtraction = layoutExtraction;
      let parserQualification = qualifyPdfText(layoutExtraction);

      // The verified Git-for-Windows executable is Xpdf. Its `-table` mode is
      // materially more faithful for the actual Rainpalm multi-row table than
      // its `-layout` row geometry, while still using the same local binary,
      // source hash, argument-array boundary, and deterministic text parser.
      let tableExtraction: ReturnType<typeof runPdftotextLayout> | null = null;
      if (tool.vendor === "xpdf") {
        tableExtraction = runPdftotextLayout({
          tool,
          pdfPath,
          workspaceDir,
          mode: "table",
        });
        const tableQualification = qualifyPdfText(tableExtraction);
        if (
          tableQualification.status === "QUALIFIED_SUPPORTED_LAYOUT" ||
          tableQualification.status === "REVIEW_REQUIRED"
        ) {
          parserExtraction = tableExtraction;
          parserQualification = tableQualification;
        }
      }

      qualification = {
        ...parserQualification,
        parser_mode: parserExtraction.mode,
        source_pdf_sha256: sourceProof.sha256,
        text_output_hashes: {
          layout: layoutExtraction.outputSha256,
          ...(tableExtraction ? { table: tableExtraction.outputSha256 } : {}),
        },
        tool: {
          name: "pdftotext",
          vendor: tool.vendor ?? "unknown",
          version: tool.version,
          executable_sha256: tool.executableSha256,
        },
      };
      let { regions } = extractDocumentTables(parserExtraction.pages);
      if (parserExtraction.mode === "table") {
        const merged = mergeLayoutCoreCells(regions, layoutExtraction.pages);
        regions = merged.regions;
        if (merged.conflicts.length > 0) {
          blockingIssues.push(...merged.conflicts);
          qualification = {
            ...qualification,
            status: "REVIEW_REQUIRED",
            reasons: [...qualification.reasons, ...merged.conflicts],
          };
        }
      }
      const built = buildPriceListCandidates(regions, sourceFilename);
      candidatePriceList = built.priceList;
      reviewItems.push(...built.reviewItems);
      if (built.duplicateUnitIdentities.length > 0) {
        blockingIssues.push(
          `intake_duplicate_unit_identifiers: ${built.duplicateUnitIdentities.join(", ")}`,
        );
      }
      const dateResult = extractPriceListDate(layoutExtraction.pages, sourceFilename);
      if (dateResult.fact) {
        candidatePriceList = { ...candidatePriceList, price_list_date: dateResult.fact };
      }
      if (dateResult.reviewItem) reviewItems.push(dateResult.reviewItem);
      supplementalFees = extractSupplementalFees(layoutExtraction.pages, sourceFilename);
    } catch (error) {
      const message = error instanceof PdfToolError ? error.message : String(error);
      qualification = emptyQualification(message);
      blockingIssues.push(`pdftotext_run_failed: ${message}`);
    } finally {
      // The temporary text output is already removed by runPdftotextLayout;
      // this removes the (now-empty or never-created) workspace directory
      // itself, confined strictly to the configured workspace root.
      try {
        removeManagedDir(workspaceDir, [resolve(workspaceRoot)]);
      } catch {
        /* never created, or already removed */
      }
    }
  }

  let sourcePostProcessing;
  try {
    sourcePostProcessing = assertSourceUnchanged(sourcePreProcessing, pdfPath);
  } catch (error) {
    throw new SipInputError(
      `sip_source_pdf_changed_during_extraction: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  sourceProof = {
    ...sourceProof,
    post_processing: sourcePostProcessing,
    hash_verified_unchanged_after_extraction: true,
  };
  qualification = {
    ...qualification,
    source_pdf_sha256: sourceProof.sha256,
    tool:
      qualification.tool ??
      ({
        name: "pdftotext",
        vendor: tool.vendor ?? "unknown",
        version: tool.version,
        executable_sha256: tool.executableSha256,
      } as const),
  };

  let reviewSummary = buildReviewSummary(options.projectSlug, reviewItems);
  const hasCandidateRows = (candidatePriceList.unit_inventory?.length ?? 0) > 0;
  const finalizable =
    qualification.status !== "TOOL_FAILURE" &&
    canFinalize(reviewSummary) &&
    blockingIssues.length === 0 &&
    hasCandidateRows;

  let reviewedPriceList: ExtractedPriceList | null = null;
  if (finalizable) {
    reviewedPriceList = buildReviewedPriceList(candidatePriceList);
    // Prove the finalized output passes the existing, unchanged Fast Intake
    // anti-fabrication sanitizer before it is written.
    sanitizePriceList(reviewedPriceList);
  }

  const paths = artifactDir
    ? sipArtifactPathsForDir(artifactDir)
    : sipArtifactPaths(outRoot, options.projectSlug);

  const generationId = sha256OfJson({
    source_pdf_sha256: sourceProof.sha256,
    source_pdf_byte_size: sourceProof.byte_size,
    pdf_text_tool: {
      vendor: tool.vendor,
      version: tool.version,
      executable_sha256: tool.executableSha256,
    },
    qualification,
    candidate_price_list: candidatePriceList,
    review_items: reviewItems,
    finalized_price_list: reviewedPriceList,
  });
  sourceProof = { ...sourceProof, generation_id: generationId };
  reviewSummary = {
    ...reviewSummary,
    source_pdf_sha256: sourceProof.sha256,
    generation_id: generationId,
  };

  const artifactHashes: Record<string, string> = {
    source_proof: sha256OfJson(sourceProof),
    qualification: sha256OfJson(qualification),
    candidate_price_list: sha256OfJson(candidatePriceList),
    review_summary: sha256OfJson(reviewSummary),
  };
  if (reviewedPriceList) artifactHashes.reviewed_price_list = sha256OfJson(reviewedPriceList);

  const preparationSummary: PreparationSummary = {
    sip_schema_version: SIP_SCHEMA_VERSION,
    project_slug: options.projectSlug,
    poppler_version: tool.vendor === "poppler" ? tool.version : null,
    pdf_text_tool: {
      name: "pdftotext",
      vendor: tool.vendor,
      version: tool.version,
      executable_sha256: tool.executableSha256,
    },
    qualification_status: qualification.status,
    pages_detected: qualification.pageCount,
    tables_detected: qualification.headerMappings.length,
    rows_detected: candidatePriceList.unit_inventory?.length ?? 0,
    candidate_row_count: candidatePriceList.unit_inventory?.length ?? 0,
    accepted_row_count: reviewedPriceList?.unit_inventory?.length ?? 0,
    review_item_count: reviewItems.length,
    rejected_row_count: reviewItems.filter((item) => item.recommendedAction === "reject").length,
    safely_omitted_value_count: reviewItems.filter(
      (item) => !item.blocking && item.recommendedAction === "unresolved",
    ).length,
    blocking_issues: blockingIssues,
    finalized: reviewedPriceList !== null,
    generation_id: generationId,
    source_pdf_sha256: sourceProof.sha256,
    artifact_hashes: artifactHashes,
    ...(supplementalFees && supplementalFees.length > 0
      ? { supplemental_fees: supplementalFees }
      : {}),
    no_import_statement:
      "No Progressive import, database client, or production write occurred in this preparation run.",
    no_publication_statement: "No project was published by this run.",
  };

  writeSipArtifacts({
    paths,
    sourceProof,
    qualification,
    candidatePriceList,
    reviewSummary,
    preparationSummary,
    reviewedPriceList,
    hooks: options.artifactHooks,
  });

  return {
    qualification,
    sourceProof,
    candidatePriceList,
    reviewItems,
    reviewedPriceList,
    preparationSummary,
    paths,
  };
}
