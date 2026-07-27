/**
 * Package Factory — the operator CLI.
 *
 *   npm run package:factory -- --source-set <file.json> --output <dir>
 *   npm run package:factory -- --batch <dir-of-source-sets> --output <dir>
 *
 * Options:
 *   --dry-run              generate nothing; print what would be produced
 *   --publish-production   publish the generated packages (the ONLY write path)
 *   --max-gallery <n>      gallery cap (default 24)
 *   --max-plans <n>        floor/unit plan cap (default 13)
 *   --report <path>        write the exception report as JSON
 *   --allow-network        permit the Google Drive / website adapters to fetch
 *
 * Rules this file is responsible for:
 *   - package generation is the default; publication needs an explicit flag;
 *   - staging is refused, always, by the shared production-target guard;
 *   - credentials come only from the process environment and are never printed;
 *   - a source set with no Telegram, or with no current price, runs normally;
 *   - one failed project in a batch never stops the valid ones.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  assertProductionTarget,
  DIRECT_PUBLISH_TARGET,
  PRODUCTION_PROJECT_REF,
} from "../forever-direct-publish/target";

import { renderExceptionReport, type ExceptionReport } from "./exceptions";
import type { ProductionIdentityReader, ProductionProject } from "./identity";
import { runFactoryBatch, type FactoryResult } from "./pipeline";
import { parseSourceSet, type SourceSet } from "./source-set";

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run package:factory -- --source-set <file.json> --output <dir>");
  console.log("  npm run package:factory -- --batch <dir-of-source-sets> --output <dir>");
  console.log("");
  console.log("  --dry-run              plan only; write nothing");
  console.log("  --publish-production   publish the generated packages to production");
  console.log("  --max-gallery <n>      gallery cap (default 24)");
  console.log("  --max-plans <n>        floor/unit plan cap (default 13)");
  console.log("  --report <path>        write the exception report as JSON");
  console.log("  --allow-network        let the Drive/website adapters fetch");
  console.log("  --production-identity  resolve identity against production (read-only)");
  console.log("");
  console.log("Telegram is optional. A source set with only a local folder, only an");
  console.log("uploaded archive or only one official PDF is an ordinary run.");
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function numericFlag(args: string[], flag: string): number | undefined {
  const raw = flagValue(args, flag);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    console.error(`${flag} must be a positive whole number; received "${raw}".`);
    process.exit(1);
  }
  return value;
}

/** Production identity reader over the service-role client. Never prints a key. */
async function createProductionReader(): Promise<ProductionIdentityReader> {
  const { createProductionClient } = await import("../forever-direct-publish/deps.server");
  const { client, target } = createProductionClient();
  assertProductionTarget({ supabaseUrl: target.url, requestedTarget: DIRECT_PUBLISH_TARGET });
  return {
    async listProjects(): Promise<readonly ProductionProject[]> {
      const { data, error } = await client
        .from("projects")
        .select("id,slug,name,public_status")
        .limit(1000);
      if (error) throw new Error(`project listing failed: ${error.message}`);
      return (data ?? []).map((row) => {
        const record = row as Record<string, unknown>;
        return {
          id: String(record.id),
          slug: String(record.slug),
          name: String(record.name ?? ""),
          publicStatus: record.public_status === null ? null : String(record.public_status),
        };
      });
    },
  };
}

/**
 * Offline identity reader.
 *
 * A generate-only run must never construct a client or read a credential.
 * Returning `null` — rather than an empty list — tells the resolver that
 * production was NOT consulted, so an Owner-stated existing slug is still
 * honoured instead of being treated as absent.
 */
const OFFLINE_READER: ProductionIdentityReader = {
  async listProjects() {
    return null;
  },
};

async function loadSourceSets(args: string[]): Promise<Array<{ path: string; set: SourceSet }>> {
  const single = flagValue(args, "--source-set");
  const batch = flagValue(args, "--batch");
  const paths: string[] = [];
  if (single) paths.push(resolve(single));
  if (batch) {
    const root = resolve(batch);
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        paths.push(join(root, entry.name));
      }
    }
    paths.sort();
  }

  const loaded: Array<{ path: string; set: SourceSet }> = [];
  for (const path of paths) {
    try {
      loaded.push({ path, set: parseSourceSet(JSON.parse(await readFile(path, "utf8"))) });
    } catch (error) {
      const failure = error as { code?: string; message?: string };
      // A malformed source set is that project's failure alone.
      console.log(
        `FAILED     ${basename(path)}  [${failure.code ?? "source_set_unreadable"}] ${failure.message}`,
      );
    }
  }
  return loaded;
}

async function writePackage(outputRoot: string, slug: string, files: Map<string, Buffer>) {
  const directory = join(outputRoot, slug);
  // Regenerating replaces: a stale file from an earlier run must never survive
  // into a package whose fingerprint says it is current.
  await rm(directory, { recursive: true, force: true });
  for (const [relativePath, bytes] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const target = join(directory, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  return directory;
}

function printResult(name: string, result: FactoryResult, directory: string | null): void {
  const { counts, identity } = result;
  console.log("");
  console.log(`${name}`);
  console.log(`  identity:      ${identity.outcome}${identity.slug ? ` → ${identity.slug}` : ""}`);
  if (identity.outcome !== "ambiguous_identity") {
    console.log(`  operation:     ${identity.operation}`);
    console.log(
      `  extracted:     artifacts=${counts.artifacts} reposts=${counts.reposts} ` +
        `buildings=${counts.buildings} units=${counts.units} prices=${counts.prices} media=${counts.media}`,
    );
    if (result.parse) {
      console.log(`  layout:        ${result.parse.layoutId} (${result.parse.validationMethod})`);
      console.log(
        `  rows:          accepted=${result.parse.accepted.length} rejected=${result.parse.rejected.length} unresolved=${result.parse.unresolved.length}`,
      );
    }
    if (result.package) console.log(`  fingerprint:   ${result.package.batch.batch_fingerprint}`);
  }
  console.log(`  processing:    ${(result.elapsedMs / 1000).toFixed(1)}s`);
  if (directory) console.log(`  package:       ${basename(directory)}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(args.length ? 0 : 1);
  }

  const dryRun = args.includes("--dry-run");
  const publish = args.includes("--publish-production");
  const allowNetwork = args.includes("--allow-network");
  const outputRoot = flagValue(args, "--output");
  const reportPath = flagValue(args, "--report");

  if (publish && dryRun) {
    console.error("--dry-run and --publish-production are mutually exclusive.");
    process.exit(1);
  }
  if (!dryRun && !outputRoot) {
    console.error("--output <dir> is required unless --dry-run is given.");
    process.exit(1);
  }

  const sourceSets = await loadSourceSets(args);
  if (sourceSets.length === 0) {
    printUsage();
    process.exit(1);
  }

  // Publication always needs the production view. Generation may opt into it
  // with --production-identity, which is what lets identity resolution search
  // real production slugs and aliases; without the flag it stays fully offline.
  const useProductionIdentity = publish || args.includes("--production-identity");
  const reader = useProductionIdentity ? await createProductionReader() : OFFLINE_READER;
  if (publish) {
    console.log(`Target verified: ${DIRECT_PUBLISH_TARGET} (${PRODUCTION_PROJECT_REF})`);
  } else if (useProductionIdentity) {
    console.log(
      `Identity resolved against production ${PRODUCTION_PROJECT_REF} (read-only). No write will be performed.`,
    );
  } else {
    console.log(
      "Generating packages only. No client was created, no credential was read, and no write was performed.",
    );
  }

  const options = {
    maxGallery: numericFlag(args, "--max-gallery"),
    maxPlans: numericFlag(args, "--max-plans"),
  };

  // One failed project never stops the valid ones: the batch runner captures
  // each project's outcome independently.
  const outcomes = await runFactoryBatch(
    sourceSets.map(({ path, set }) => ({ name: basename(path, ".json"), sourceSet: set })),
    reader,
    { allowNetwork },
    options,
  );

  const reports: ExceptionReport[] = [];
  const generated: Array<{ slug: string; directory: string }> = [];
  let failures = 0;

  for (const outcome of outcomes) {
    reports.push(outcome.report);
    if (outcome.report.blocked) failures += 1;
    if (!outcome.result) {
      const message = outcome.report.exceptions[0]?.message ?? "The Factory failed.";
      console.log(`\n${outcome.name}\n  FAILED [factory_failed] ${message}`);
      continue;
    }
    let directory: string | null = null;
    if (outcome.result.package && !dryRun && outputRoot) {
      directory = await writePackage(
        resolve(outputRoot),
        outcome.result.identity.slug!,
        outcome.result.package.files,
      );
      generated.push({ slug: outcome.result.identity.slug!, directory });
    }
    printResult(outcome.name, outcome.result, directory);
  }

  console.log("\n--- Exceptions ---");
  console.log(renderExceptionReport(reports));

  if (reportPath) {
    await mkdir(dirname(resolve(reportPath)), { recursive: true });
    await writeFile(resolve(reportPath), `${JSON.stringify({ reports }, null, 2)}\n`, "utf8");
    console.log(`\nException report written to ${basename(reportPath)}.`);
  }

  if (publish && generated.length > 0) {
    const { readSourcePackage } = await import("../forever-direct-publish/source-package");
    const { createDirectPublishDeps } = await import("../forever-direct-publish/deps.server");
    const { publishProjects } = await import("../forever-direct-publish/publish");

    const actorId = process.env.STUDIO_OWNER_USER_ID;
    if (!actorId) {
      console.error("Missing required environment variable: STUDIO_OWNER_USER_ID.");
      process.exit(1);
    }
    const deps = createDirectPublishDeps();
    assertProductionTarget({ supabaseUrl: deps.target.url, requestedTarget: deps.target.target });

    const packages = [];
    for (const item of generated) {
      packages.push(await readSourcePackage(item.directory));
    }
    const results = await publishProjects(packages, deps, {
      role: process.env.FOREVER_DIRECT_PUBLISH_ROLE ?? "owner",
      actorId,
      actorEmail: process.env.STUDIO_OWNER_EMAIL ?? null,
      maxGallery: options.maxGallery,
      maxPlans: options.maxPlans,
    });
    console.log("\n--- Publication ---");
    for (const result of results) {
      if (result.status === "published") {
        console.log(
          `PUBLISHED  ${result.slug}  ${result.publicUrl ?? result.publicPath}  ` +
            `(mode=${result.mode} buildings=${result.counts?.buildings ?? 0} units=${result.counts?.units ?? 0} ` +
            `prices=${result.counts?.prices ?? 0} media=${result.counts?.media ?? 0} replayed=${result.replayed})`,
        );
      } else {
        failures += 1;
        console.log(
          `FAILED     ${result.slug ?? result.packageRef}  [${result.errorCode}] ${result.error}`,
        );
      }
    }
  }

  if (failures > 0) process.exit(2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
