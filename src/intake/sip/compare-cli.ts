/**
 * SIP-001A — post-extraction ground-truth comparison CLI (separate command).
 *
 * This command is the ONLY place SIP-001A reads the manually reviewed
 * ground-truth comparison JSON, and only after the finalized deterministic price
 * list already exists on disk. It never writes back into the reviewed
 * output and performs no import, publication, database, or network action.
 *
 *   npm run sip:compare-price-list -- --reviewed "<reviewed-price-list.json>" --ground-truth "<price-list.json>" [--review-summary "<review-summary.json>"]
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { atomicWriteJson } from "../fs-utils";
import { compareAgainstGroundTruth, readExtractedPriceListFile } from "./compare";
import type { PreparationSummary, ReviewSummary } from "./types";

interface CompareCliOptions {
  reviewedPath: string;
  groundTruthPath: string;
  reviewSummaryPath?: string;
  preparationSummaryPath?: string;
  outputPath?: string;
  manualReviewTimeSeconds?: number;
}

function parseArgs(args: string[]): CompareCliOptions | { error: string } {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) return { error: `Unexpected argument "${arg}".` };
    const value = args[i + 1];
    if (value === undefined) return { error: `Flag "${arg}" requires a value.` };
    values[arg] = value;
    i += 1;
  }
  if (!values["--reviewed"]) return { error: '--reviewed "<path>" is required.' };
  if (!values["--ground-truth"]) return { error: '--ground-truth "<path>" is required.' };
  const manualReviewTime = values["--manual-review-seconds"];
  if (manualReviewTime !== undefined && !/^\d+$/.test(manualReviewTime)) {
    return { error: "--manual-review-seconds must be a non-negative integer." };
  }
  return {
    reviewedPath: values["--reviewed"],
    groundTruthPath: values["--ground-truth"],
    reviewSummaryPath: values["--review-summary"],
    preparationSummaryPath: values["--preparation-summary"],
    outputPath: values["--out"],
    manualReviewTimeSeconds: manualReviewTime === undefined ? undefined : Number(manualReviewTime),
  };
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function main(): void {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const parsed = parseArgs(args);
  if ("error" in parsed) {
    console.error(`SIP-001A compare: ${parsed.error}`);
    console.log(
      'Usage: npm run sip:compare-price-list -- --reviewed "<reviewed-price-list.json>" --ground-truth "<price-list.json>" [--review-summary "<review-summary.json>"] [--preparation-summary "<preparation-summary.json>"] [--manual-review-seconds <n>] [--out "<comparison-report.json>"]',
    );
    process.exit(1);
  }

  const reviewed = readExtractedPriceListFile(parsed.reviewedPath);
  const groundTruth = readExtractedPriceListFile(parsed.groundTruthPath);
  let reviewItemCount = 0;
  if (parsed.reviewSummaryPath) {
    const summary = JSON.parse(readFileSync(parsed.reviewSummaryPath, "utf8")) as ReviewSummary;
    reviewItemCount = summary.items?.length ?? 0;
  }

  const metrics = compareAgainstGroundTruth(reviewed, groundTruth, {
    reviewItemCount,
    manualReviewTimeSeconds: parsed.manualReviewTimeSeconds,
  });
  let report = metrics;
  if (parsed.preparationSummaryPath) {
    const preparation = JSON.parse(
      readFileSync(parsed.preparationSummaryPath, "utf8"),
    ) as PreparationSummary;
    const finalizedHash = sha256File(parsed.reviewedPath);
    if (preparation.artifact_hashes.reviewed_price_list !== finalizedHash) {
      throw new Error("sip_compare_generation_mismatch: finalized price-list hash differs.");
    }
    report = {
      sip_schema_version: "1",
      project_slug: preparation.project_slug,
      source_pdf_sha256: preparation.source_pdf_sha256,
      generation_id: preparation.generation_id,
      finalized_price_list_sha256: finalizedHash,
      ground_truth_sha256: sha256File(parsed.groundTruthPath),
      ...metrics,
    };
  }
  if (parsed.outputPath) atomicWriteJson(parsed.outputPath, report);
  const line = "─".repeat(60);
  console.log(line);
  console.log("SIP-001A ground-truth comparison (read-only, post-extraction)");
  console.log(line);
  for (const [metric, value] of Object.entries(report)) {
    if (typeof value === "object" && value !== null && "numerator" in value) {
      console.log(`${metric}: ${value.numerator}/${value.denominator}`);
    } else {
      console.log(`${metric}: ${value}`);
    }
  }
  console.log(line);
  if (parsed.outputPath) console.log(`Portable report: ${parsed.outputPath}`);
  console.log("This comparison did not modify extraction output. No import, no publication.");
  console.log(line);
}

main();
