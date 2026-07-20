/**
 * SIP-001A — generated local artifact writer.
 *
 * Reuses the existing Fast Intake atomic JSON writer. Every artifact is
 * UTF-8 without a BOM, two-space indented, with a trailing newline. Nothing
 * here contains the raw PDF, temporary extracted text, credentials, or an
 * absolute Owner-machine path outside the explicitly operational
 * `local_only_path` field.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";

import type { ExtractedPriceList } from "@/import/types";

import { atomicWriteJson, toCanonicalJson } from "../fs-utils";
import type { PreparationSummary, QualificationResult, ReviewSummary, SourceProof } from "./types";

export interface SipArtifactPaths {
  source_proof: string;
  qualification: string;
  candidate_price_list: string;
  review_summary: string;
  preparation_summary: string;
  reviewed_price_list: string;
}

export function sipArtifactPaths(outRoot: string, projectSlug: string): SipArtifactPaths {
  const dir = join(outRoot, projectSlug, "sip");
  return {
    source_proof: join(dir, "source-proof.json"),
    qualification: join(dir, "qualification.json"),
    candidate_price_list: join(dir, "candidate-price-list.json"),
    review_summary: join(dir, "review-summary.json"),
    preparation_summary: join(dir, "preparation-summary.json"),
    reviewed_price_list: join(dir, "reviewed-price-list.json"),
  };
}

export function sha256OfJson(value: unknown): string {
  return createHash("sha256").update(toCanonicalJson(value)).digest("hex");
}

export interface WriteSipArtifactsInput {
  paths: SipArtifactPaths;
  sourceProof: SourceProof;
  qualification: QualificationResult;
  candidatePriceList: ExtractedPriceList;
  reviewSummary: ReviewSummary;
  preparationSummary: PreparationSummary;
  reviewedPriceList: ExtractedPriceList | null;
}

export function writeSipArtifacts(input: WriteSipArtifactsInput): void {
  atomicWriteJson(input.paths.source_proof, input.sourceProof);
  atomicWriteJson(input.paths.qualification, input.qualification);
  atomicWriteJson(input.paths.candidate_price_list, input.candidatePriceList);
  atomicWriteJson(input.paths.review_summary, input.reviewSummary);
  atomicWriteJson(input.paths.preparation_summary, input.preparationSummary);
  if (input.reviewedPriceList) {
    atomicWriteJson(input.paths.reviewed_price_list, input.reviewedPriceList);
  }
}
