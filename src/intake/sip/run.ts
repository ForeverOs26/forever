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
 *   → reviewed final JSON (only when no blocking issue remains)
 *
 * This module NEVER reads the manually reviewed ground-truth comparison
 * JSON. That file is read only by the separate `compare.ts` module, after
 * this orchestrator has already fixed its output. No database client, no
 * network request, no import, no publication — only local generated
 * artifacts under `forever-data/projects/<slug>/sip/`.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

import type { ExtractedPriceList } from "@/import/types";

import { assertSafeSlug, removeManagedDir } from "../paths";
import { sanitizePriceList } from "../sanitize";
import { sipArtifactPaths, sha256OfJson, writeSipArtifacts } from "./artifacts";
import {
  buildPriceListCandidates,
  buildReviewedPriceList,
  extractPriceListDate,
  resetReviewIdCounter,
} from "./candidate-normalize";
import { PdfToolError, preflightPdftotext, runPdftotextLayout } from "./pdf-tool";
import { qualifyPdfText } from "./pdf-qualify";
import { extractDocumentTables } from "./price-table";
import { buildReviewSummary, canFinalize } from "./review";
import type { PreparationSummary, QualificationResult, ReviewItem, SourceProof } from "./types";
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

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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
  const workspaceDir = resolve(
    workspaceRoot,
    `${options.projectSlug}-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
  );

  const fileStat = statSync(pdfPath);
  const sourceFilename = basename(pdfPath);
  const sourceProof: SourceProof = {
    sip_schema_version: SIP_SCHEMA_VERSION,
    project_slug: options.projectSlug,
    source_filename: sourceFilename,
    sha256: sha256File(pdfPath),
    byte_size: fileStat.size,
    local_only_path: pdfPath,
  };

  const tool = preflightPdftotext();
  const reviewItems: ReviewItem[] = [];
  const blockingIssues: string[] = [];
  let qualification: QualificationResult;
  let candidatePriceList: ExtractedPriceList = { unit_inventory: [] };

  if (!tool.found) {
    qualification = emptyQualification(tool.error ?? "pdftotext_not_available");
    blockingIssues.push(
      "BLOCKED — AUTHORIZED PDF TEXT TOOL REQUIRED: pdftotext was not found on this machine.",
    );
  } else {
    try {
      const extraction = runPdftotextLayout({ tool, pdfPath, workspaceDir });
      qualification = qualifyPdfText(extraction);
      const { regions } = extractDocumentTables(extraction.pages);
      const built = buildPriceListCandidates(regions, sourceFilename);
      candidatePriceList = built.priceList;
      reviewItems.push(...built.reviewItems);
      if (built.duplicateUnitIdentities.length > 0) {
        blockingIssues.push(
          `intake_duplicate_unit_identifiers: ${built.duplicateUnitIdentities.join(", ")}`,
        );
      }
      const dateResult = extractPriceListDate(extraction.pages, sourceFilename);
      if (dateResult.fact) {
        candidatePriceList = { ...candidatePriceList, price_list_date: dateResult.fact };
      }
      if (dateResult.reviewItem) reviewItems.push(dateResult.reviewItem);
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

  const reviewSummary = buildReviewSummary(options.projectSlug, reviewItems);
  const hasCandidateRows = (candidatePriceList.unit_inventory?.length ?? 0) > 0;
  const finalizable =
    qualification.status !== "TOOL_FAILURE" &&
    canFinalize(reviewSummary) &&
    blockingIssues.length === 0 &&
    hasCandidateRows;

  let reviewedPriceList: ExtractedPriceList | null = null;
  if (finalizable) {
    reviewedPriceList = buildReviewedPriceList(candidatePriceList);
    // Prove the reviewed output passes the existing, unchanged Fast Intake
    // anti-fabrication sanitizer before it is written.
    sanitizePriceList(reviewedPriceList);
  }

  const paths = sipArtifactPaths(outRoot, options.projectSlug);

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
    poppler_version: tool.version,
    qualification_status: qualification.status,
    pages_detected: qualification.pageCount,
    tables_detected: qualification.headerMappings.length,
    rows_detected: candidatePriceList.unit_inventory?.length ?? 0,
    candidate_row_count: candidatePriceList.unit_inventory?.length ?? 0,
    accepted_row_count: reviewedPriceList?.unit_inventory?.length ?? 0,
    review_item_count: reviewItems.length,
    rejected_row_count: reviewItems.filter((item) => item.recommendedAction === "reject").length,
    blocking_issues: blockingIssues,
    finalized: reviewedPriceList !== null,
    artifact_hashes: artifactHashes,
    no_import_statement:
      "No Progressive import, database client, or production write occurred in this preparation run.",
    no_publication_statement:
      "No project was published by this run; Rainpalm remains unimported and unpublished.",
  };

  writeSipArtifacts({
    paths,
    sourceProof,
    qualification,
    candidatePriceList,
    reviewSummary,
    preparationSummary,
    reviewedPriceList,
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
