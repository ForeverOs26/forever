/**
 * SIP-001A — post-extraction ground-truth comparison CLI (separate command).
 *
 * This command is the ONLY place SIP-001A reads the manually reviewed
 * ground-truth comparison JSON, and only after the reviewed final price
 * list already exists on disk. It never writes back into the reviewed
 * output and performs no import, publication, database, or network action.
 *
 *   npm run sip:compare-price-list -- --reviewed "<reviewed-price-list.json>" --ground-truth "<price-list.json>" [--review-summary "<review-summary.json>"]
 */

import { readFileSync } from "node:fs";

import { compareAgainstGroundTruth, readExtractedPriceListFile } from "./compare";
import type { ReviewSummary } from "./types";

interface CompareCliOptions {
  reviewedPath: string;
  groundTruthPath: string;
  reviewSummaryPath?: string;
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
  return {
    reviewedPath: values["--reviewed"],
    groundTruthPath: values["--ground-truth"],
    reviewSummaryPath: values["--review-summary"],
  };
}

function main(): void {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const parsed = parseArgs(args);
  if ("error" in parsed) {
    console.error(`SIP-001A compare: ${parsed.error}`);
    console.log(
      'Usage: npm run sip:compare-price-list -- --reviewed "<reviewed-price-list.json>" --ground-truth "<price-list.json>" [--review-summary "<review-summary.json>"]',
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

  const report = compareAgainstGroundTruth(reviewed, groundTruth, { reviewItemCount });
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
  console.log("This comparison did not modify the reviewed output. No import, no publication.");
  console.log(line);
}

main();
