/**
 * TG-WATCH-001A — owner-only local CLI entry point.
 *
 * Never part of the web bundle; no Telegram session, no credentials, no
 * network, no database client, no production write — only local quarantine
 * and review artifacts under the watch root.
 *
 * Windows PowerShell and cmd.exe (single line; `npm.cmd` because `npm.ps1`
 * may be blocked by a normal execution policy):
 *
 *   npm.cmd run tg-watch -- --channel '@coralinakamala' --export "C:\forever-incoming\tg-export\coralinakamala"
 *
 * Bash / Linux / macOS:
 *
 *   npm run tg-watch -- --channel @coralinakamala --export "/path/to/export"
 */

import { parseWatchInvocation } from "./cli-args";
import { defaultWatchRoot, runWatch } from "./run";

function printUsage(): void {
  console.log("Usage:");
  console.log(
    "  Windows PowerShell:               npm.cmd run tg-watch -- --channel '@name' --export \"<export-folder>\"",
    '  Windows cmd.exe:                  npm.cmd run tg-watch -- --channel @name --export "<export-folder>"',
  );
  console.log(
    '  Bash/Linux/macOS:                 npm run tg-watch -- --channel @name --export "<export-folder>"',
  );
  console.log("");
  console.log("Options:");
  console.log("  --channel @name        Registered public channel reference (required).");
  console.log(
    '  --export "<folder>"    Telegram Desktop JSON export folder containing result.json (required).',
  );
  console.log(
    "  --registry <path>      Channel registry (default forever-data/watch/channel-registry.json).",
  );
  console.log(
    `  --out-root <dir>       Runtime root for quarantine/ledger/review (default ${defaultWatchRoot()}; never inside the repository).`,
  );
  console.log("  --max-attachment-mb <n>  Per-attachment size ceiling in MiB (default 512).");
  console.log("  --run-at <ISO>         Fixed run timestamp for deterministic repeat proofs.");
  console.log("  --verbose              List every reviewed item on the console.");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }
  const parsed = parseWatchInvocation(args);
  if (!parsed.ok) {
    console.error(`Telegram Watch: ${parsed.error}`);
    printUsage();
    process.exit(1);
  }

  const result = await runWatch({
    channel: parsed.options.channel,
    exportDir: parsed.options.exportDir,
    registryPath: parsed.options.registryPath,
    outRoot: parsed.options.outRoot,
    maxAttachmentBytes: parsed.options.maxAttachmentBytes,
    runAt: parsed.options.runAt,
  });

  const line = "─".repeat(60);
  console.log(line);
  if (!result.report || !result.artifacts) {
    console.log("Telegram Watch — BLOCKED");
    console.log(line);
    console.log(`Error: ${result.error}`);
    console.log(line);
    process.exit(result.exitCode);
    return;
  }
  const report = result.report;
  console.log(`Telegram Watch — ${report.channel}`);
  console.log(line);
  console.log(`Developer      : ${report.developer_name} (${report.developer_slug})`);
  console.log(
    `Project        : ${report.project_name ? `${report.project_name} (${report.project_slug})` : "not assigned"}`,
  );
  console.log(
    `Snapshot       : ${report.snapshot.message_count} post(s), sha256 ${report.snapshot.sha256.slice(0, 12)}…`,
  );
  console.log(
    `Changes        : new=${report.counts.new_messages} edited=${report.counts.edited_messages} unchanged=${report.counts.unchanged_messages}`,
  );
  console.log(
    `Quarantine     : stored=${report.counts.attachments_stored} dup-in-channel=${report.counts.attachments_duplicate_in_channel} dup-cross-channel=${report.counts.attachments_duplicate_cross_channel}`,
  );
  const buckets = Object.entries(report.counts.bucket_counts)
    .filter(([, count]) => count > 0)
    .map(([bucket, count]) => `${bucket}=${count}`)
    .join(", ");
  console.log(`Buckets        : ${buckets || "(none)"}`);
  console.log(
    `Cursor         : ${report.cursor.previous_last_processed_message_id} → ${report.cursor.new_last_processed_message_id}`,
  );
  for (const warning of report.warnings) console.log(`  warning: ${warning}`);
  if (parsed.options.verbose) {
    for (const item of report.items) {
      console.log(`  [${item.change}] #${item.message_id} ${item.buckets.join("/") || "text"}`);
      console.log(`    ${item.recommended_action}`);
    }
  }
  console.log(line);
  console.log("Owner review:");
  console.log(`  ${result.artifacts.report_markdown}`);
  console.log(`  ${result.artifacts.report}`);
  console.log(line);
  console.log(report.no_extraction_statement);
  console.log(report.no_import_statement);
  console.log(report.no_publication_statement);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
