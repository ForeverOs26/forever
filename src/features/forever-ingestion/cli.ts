/**
 * Progressive ingestion — owner-only CLI entry point.
 *
 * Usage (matches the existing `npm run import` convention; jiti-executed,
 * never part of the web bundle):
 *
 *   npm run ingest -- --file <payload.json>              build + execute
 *   npm run ingest -- --file <payload.json> --dry-run    build + print only
 *   npm run ingest -- --publish <project-slug>           explicit publish
 *   npm run ingest -- --unpublish <project-slug>         back to draft
 *
 * The payload file is either a ready ProgressiveBatch (already carrying
 * batch_fingerprint) or a builder input:
 *   { "mode": "create" | "enrich", "project": {...},
 *     "priceList": <extracted price-list JSON>, "countryEvidence": {...},
 *     "media": [...] }
 *
 * Credentials come exclusively from the environment (SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY), exactly like src/import/database.ts. Dry-run
 * creates no database client and touches no network.
 */

import { readFile } from "node:fs/promises";

import type { ProgressiveBatch, ProgressiveBatchSummary } from "./batch-types";
import { buildProgressiveBatch, fingerprintBatch, type BuildBatchInput } from "./build-batch";
import { classifyCliPayload } from "./cli-payload";
import type { DependencyReader } from "./dependency-resolution";
import { fetchExistingProjectState } from "./existing-state";
import {
  createDependencyReader,
  createProgressiveIngestClient,
  createServiceRoleClient,
} from "./ingest-client";

/** Dry-run resolver: no network, no client; linking happens at execute time. */
const offlineReader: DependencyReader = {
  findDevelopers: async () => [],
  findLocations: async () => [],
};

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run ingest -- --file <payload.json> [--dry-run]");
  console.log("  npm run ingest -- --publish <project-slug>");
  console.log("  npm run ingest -- --unpublish <project-slug>");
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function publicationBatch(slug: string, publish: boolean): ProgressiveBatch {
  const body = {
    schema_version: "1" as const,
    mode: "enrich" as const,
    project: { slug, publish },
  };
  return { ...body, batch_fingerprint: fingerprintBatch(body) };
}

function printSummary(summary: ProgressiveBatchSummary): void {
  console.log(JSON.stringify(summary, null, 2));
}

function printPlan(batch: ProgressiveBatch): void {
  console.log(`Mode: ${batch.mode}`);
  console.log(`Project: ${batch.project.slug}`);
  console.log(`Fingerprint: ${batch.batch_fingerprint}`);
  console.log(
    `Planned rows: buildings=${batch.buildings?.length ?? 0} units=${batch.units?.length ?? 0} ` +
      `prices=${batch.prices?.length ?? 0} media=${batch.media?.length ?? 0}`,
  );
  for (const warning of batch.warnings ?? []) {
    console.log(`warning [${warning.code}] ${warning.entity}: ${warning.message}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(args.length ? 0 : 1);
  }

  const publishSlug = flagValue(args, "--publish");
  const unpublishSlug = flagValue(args, "--unpublish");
  if (publishSlug || unpublishSlug) {
    const batch = publicationBatch(publishSlug ?? unpublishSlug!, Boolean(publishSlug));
    const summary = await createProgressiveIngestClient().ingest(batch);
    printSummary(summary);
    return;
  }

  const file = flagValue(args, "--file");
  if (!file) {
    printUsage();
    process.exit(1);
  }
  const dryRun = args.includes("--dry-run");
  const payload = JSON.parse(await readFile(file, "utf-8")) as unknown;
  const classified = classifyCliPayload(payload, dryRun);
  if (classified.kind === "ready") {
    printPlan(classified.batch);
    console.log("Dry run only. No database client was created and no write was performed.");
    return;
  }
  const input = classified.input as BuildBatchInput;
  const modeOverride = flagValue(args, "--mode");
  if (modeOverride === "create" || modeOverride === "enrich") input.mode = modeOverride;
  if (input.mode !== "create" && input.mode !== "enrich") {
    throw new Error("Payload must specify mode 'create' or 'enrich' (or pass --mode).");
  }

  if (dryRun) {
    const batch = await buildProgressiveBatch(offlineReader, input);
    printPlan(batch);
    console.log(
      "Dry run only. Dependency linking and precedence checks against the live database run at execute time. No database client was created and no write was performed.",
    );
    return;
  }

  const client = createServiceRoleClient();
  const reader = createDependencyReader(client);
  if (input.mode === "enrich" && !input.existing) {
    input.existing = await fetchExistingProjectState(client, input.project.slug);
  }
  const batch = await buildProgressiveBatch(reader, input);
  printPlan(batch);
  printSummary(await createProgressiveIngestClient(client).ingest(batch));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
