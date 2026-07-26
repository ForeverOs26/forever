/**
 * Owner Direct Publish — CLI entry point
 * (FOREVER-STUDIO-OWNER-DIRECT-PUBLISH-001, Phase 7).
 *
 * One reusable Owner-only operation that publishes one project or a list of
 * projects straight to production, returning each public URL. No draft, no
 * staging, no per-project branch or pull request.
 *
 *   npm run publish:direct -- --package <dir>                      one project
 *   npm run publish:direct -- --package <dirA> --package <dirB>     a queue
 *   npm run publish:direct -- --packages-in <parent-dir>            every child
 *   npm run publish:direct -- --package <dir> --dry-run             plan only
 *
 * A dry run reads the package and prints the plan. It constructs no database
 * client, needs no credential, and performs no network request or write.
 *
 * Credentials come only from the environment (SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY). Nothing here prints a credential, a signed URL,
 * or an absolute local path.
 */

import { readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { planPublicMedia } from "./media-plan";
import { assessPublishability } from "./publishability";
import { publishProjects, type DirectPublishResult } from "./publish";
import { readSourcePackage, type SourcePackage } from "./source-package";
import { assertProductionTarget, DIRECT_PUBLISH_TARGET, PRODUCTION_PROJECT_REF } from "./target";
import { PUBLICATION_MODE, SOURCE_TRUST } from "./trust";

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run publish:direct -- --package <dir> [--package <dir> ...] [--dry-run]");
  console.log("  npm run publish:direct -- --packages-in <parent-dir> [--dry-run]");
  console.log("");
  console.log("Optional publication caps (defaults: 20 gallery, 6 plans per kind):");
  console.log("  --max-gallery <n>   publish up to n gallery images");
  console.log("  --max-plans <n>     publish up to n floor plans and n unit plans");
  console.log("");
  console.log("Owner-only. Publishes directly to production; no draft and no staging.");
}

function flagValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function flagValue(args: string[], flag: string): string | undefined {
  return flagValues(args, flag)[0];
}

/**
 * Optional overrides for the planner's default publication caps.
 *
 * The defaults (20 gallery, 6 plans per kind) keep an unattended run's page
 * useful. A prepared package that deliberately curated more — one unit plan per
 * available unit type, say — can raise them explicitly, and the raised value is
 * still reported in the plan rather than applied silently.
 */
function mediaLimits(args: string[]): { maxGallery?: number; maxPlans?: number } {
  const read = (flag: string): number | undefined => {
    const raw = flagValue(args, flag);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      console.error(`${flag} must be a positive whole number; received "${raw}".`);
      process.exit(1);
    }
    return value;
  };
  return { maxGallery: read("--max-gallery"), maxPlans: read("--max-plans") };
}

async function collectPackageDirectories(args: string[]): Promise<string[]> {
  const directories = flagValues(args, "--package").map((value) => resolve(value));
  const parent = flagValue(args, "--packages-in");
  if (parent) {
    const root = resolve(parent);
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) directories.push(resolve(root, entry.name));
    }
  }
  return [...new Set(directories)];
}

function printPlan(pkg: SourcePackage, limits: { maxGallery?: number; maxPlans?: number }): void {
  const verdict = assessPublishability(pkg.batch);
  console.log(`\nPackage: ${pkg.ref}`);
  console.log(`  mode (declared):  ${pkg.batch.mode}`);
  console.log(`  slug:             ${pkg.batch.project.slug}`);
  console.log(`  name:             ${pkg.batch.project.name ?? "(from existing project)"}`);
  console.log(
    `  rows:             buildings=${pkg.batch.buildings?.length ?? 0} units=${pkg.batch.units?.length ?? 0} prices=${pkg.batch.prices?.length ?? 0}`,
  );
  console.log(`  package warnings: ${pkg.batch.warnings?.length ?? 0}`);
  console.log(`  publishable:      ${verdict.ok ? "yes" : `no — ${verdict.failure.code}`}`);

  if (verdict.ok) {
    const plan = planPublicMedia(pkg.media, {
      slug: verdict.slug,
      maxGallery: limits.maxGallery,
      maxFloorPlans: limits.maxPlans,
    });
    const groups = new Map<string, number>();
    for (const item of plan.items)
      groups.set(item.mediaType, (groups.get(item.mediaType) ?? 0) + 1);
    const summary =
      [...groups.entries()].map(([type, count]) => `${type}=${count}`).join(" ") || "none";
    console.log(`  media candidates: ${pkg.media.length}`);
    console.log(`  media planned:    ${summary}`);
    console.log(`  hero selected:    ${plan.hero ? basename(plan.hero.path) : "none"}`);
    console.log(`  media excluded:   ${plan.excluded.length}`);
  }
  if (pkg.skipped.length) console.log(`  files skipped:    ${pkg.skipped.length}`);
}

function printResult(result: DirectPublishResult): void {
  if (result.status === "published") {
    console.log(
      `PUBLISHED  ${result.slug}  ${result.publicUrl ?? result.publicPath}  ` +
        `(mode=${result.mode} buildings=${result.counts?.buildings ?? 0} units=${result.counts?.units ?? 0} ` +
        `prices=${result.counts?.prices ?? 0} media=${result.counts?.media ?? 0} ` +
        `hero=${result.heroPublished ? "yes" : "no"} replayed=${result.replayed})`,
    );
  } else {
    console.log(
      `FAILED     ${result.slug ?? result.packageRef}  [${result.errorCode}] ${result.error}`,
    );
  }
  for (const warning of result.warnings)
    console.log(`  warning [${warning.code}] ${warning.message}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(args.length ? 0 : 1);
  }

  const directories = await collectPackageDirectories(args);
  if (!directories.length) {
    printUsage();
    process.exit(1);
  }

  const dryRun = args.includes("--dry-run");
  const limits = mediaLimits(args);
  const packages: SourcePackage[] = [];
  for (const directory of directories) {
    try {
      packages.push(await readSourcePackage(directory));
    } catch (error) {
      const failure = error as { code?: string; message?: string };
      console.log(
        `FAILED     ${basename(directory)}  [${failure.code ?? "package_unreadable"}] ${failure.message}`,
      );
    }
  }
  if (!packages.length) process.exit(1);

  if (dryRun) {
    // Prove the intended target without constructing a client or a request.
    console.log(`Target: ${DIRECT_PUBLISH_TARGET} (${PRODUCTION_PROJECT_REF})`);
    console.log(`source_trust=${SOURCE_TRUST} publication_mode=${PUBLICATION_MODE}`);
    for (const pkg of packages) printPlan(pkg, limits);
    console.log("\nDry run only. No client was created, no upload and no write was performed.");
    return;
  }

  // Deferred import: a dry run must never touch credential-reading code.
  const { createDirectPublishDeps } = await import("./deps.server");
  const deps = createDirectPublishDeps();
  assertProductionTarget({ supabaseUrl: deps.target.url, requestedTarget: deps.target.target });
  console.log(`Target verified: ${deps.target.target} (${deps.target.projectRef})`);

  const role = process.env.FOREVER_DIRECT_PUBLISH_ROLE ?? "owner";
  const actorId = process.env.STUDIO_OWNER_USER_ID;
  if (!actorId) {
    console.error(
      "Missing required environment variable: STUDIO_OWNER_USER_ID (the Owner's stable auth user id, used for provenance and audit).",
    );
    process.exit(1);
  }

  const results = await publishProjects(packages, deps, {
    role,
    actorId,
    actorEmail: process.env.STUDIO_OWNER_EMAIL ?? null,
    maxGallery: limits.maxGallery,
    maxPlans: limits.maxPlans,
  });

  console.log("");
  for (const result of results) printResult(result);

  const published = results.filter((result) => result.status === "published");
  console.log(`\n${published.length}/${results.length} published.`);
  for (const result of published) {
    if (result.publicUrl ?? result.publicPath)
      console.log(`  ${result.publicUrl ?? result.publicPath}`);
  }
  // A partial batch is a real outcome, not a crash: successful projects stay
  // published and only the exit code reports that something needs attention.
  if (published.length !== results.length) process.exit(2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
