/**
 * SIP-001A — owner-only local CLI entry point.
 *
 * Never part of the web bundle; no browser, no Supabase credentials, no
 * database client, no network, no production write, no publication. It
 * never searches the computer broadly — the PDF path is always explicit.
 *
 * Windows PowerShell and cmd.exe:
 *
 *   npm.cmd run sip:price-list -- --project rainpalm-villas --pdf "<resolved PDF path>" --out-root "forever-data/projects/rainpalm-villas/sip"
 *
 * Bash / Linux / macOS:
 *
 *   npm run sip:price-list -- --project rainpalm-villas --pdf "/path/to/price-list.pdf"
 */

import { parseSipInvocation } from "./cli-args";
import { runSipPriceListExtraction, SipInputError, type RunSipResult } from "./run";

function printUsage(): void {
  console.log("Usage:");
  console.log(
    '  Windows (PowerShell or cmd.exe):  npm.cmd run sip:price-list -- --project <slug> --pdf "<pdf-path>" [--out-root <dir>]',
  );
  console.log(
    '  Bash/Linux/macOS:                 npm run sip:price-list -- --project <slug> --pdf "<pdf-path>" [--out-root <dir>]',
  );
  console.log("");
  console.log("Options:");
  console.log("  --project <slug>   Lowercase project slug (required).");
  console.log('  --pdf "<path>"     Path to the single authorized raw price-list PDF (required).');
  console.log("  --out-root <dir>   Output root (default forever-data/projects).");
  console.log(
    "  --workspace <dir>  Gitignored local pdftotext workspace (default .sip-workspace).",
  );
  console.log("");
  console.log(
    "This command never scans the filesystem for a PDF; the path must be given explicitly.",
  );
}

function printSummary(result: RunSipResult): void {
  const line = "─".repeat(60);
  console.log(line);
  console.log(`SIP-001A price-list extraction — ${result.qualification.status}`);
  console.log(line);
  console.log(`Source file    : ${result.sourceProof.source_filename}`);
  console.log(`SHA-256        : ${result.sourceProof.sha256}`);
  console.log(`Byte size      : ${result.sourceProof.byte_size}`);
  const tool = result.preparationSummary.pdf_text_tool;
  console.log(
    `PDF text tool  : ${tool.name} ${tool.version ?? "(version unknown)"} (${tool.vendor ?? "unknown vendor"})`,
  );
  console.log(
    `Detected       : pages=${result.preparationSummary.pages_detected} tables=${result.preparationSummary.tables_detected} rows=${result.preparationSummary.rows_detected}`,
  );
  console.log(
    `Counts         : candidate=${result.preparationSummary.candidate_row_count} accepted=${result.preparationSummary.accepted_row_count} ` +
      `review=${result.preparationSummary.review_item_count} rejected=${result.preparationSummary.rejected_row_count}`,
  );
  if (result.preparationSummary.blocking_issues.length > 0) {
    console.log("Blocking issues:");
    for (const issue of result.preparationSummary.blocking_issues) console.log(`  - ${issue}`);
  } else {
    console.log("Blocking issues: none");
  }
  console.log("Artifact hashes:");
  for (const [name, hash] of Object.entries(result.preparationSummary.artifact_hashes)) {
    console.log(`  ${name}: ${hash}`);
  }
  console.log(line);
  console.log(
    `Finalized deterministic JSON: ${result.preparationSummary.finalized ? "yes" : "no"}`,
  );
  console.log("Artifacts:");
  console.log(`  ${result.paths.source_proof}`);
  console.log(`  ${result.paths.qualification}`);
  console.log(`  ${result.paths.candidate_price_list}`);
  console.log(`  ${result.paths.review_summary}`);
  console.log(`  ${result.paths.preparation_summary}`);
  if (result.preparationSummary.finalized) console.log(`  ${result.paths.reviewed_price_list}`);
  console.log(line);
  console.log(
    "No import, publication, database connection, or production write occurred. This is a local, read-only, owner-authorized preparation run only.",
  );
  console.log(line);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const parsed = parseSipInvocation(args);
  if (!parsed.ok) {
    console.error(`SIP-001A: ${parsed.error}`);
    printUsage();
    process.exit(1);
  }

  try {
    const result = runSipPriceListExtraction(parsed.options);
    printSummary(result);
    process.exit(result.qualification.status === "QUALIFIED_SUPPORTED_LAYOUT" ? 0 : 2);
  } catch (error) {
    if (error instanceof SipInputError) {
      console.error(`SIP-001A: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
