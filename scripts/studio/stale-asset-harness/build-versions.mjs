#!/usr/bin/env node
/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — two-version build harness.
 *
 * Produces TWO real production builds of this repository whose content-hashed
 * client chunks genuinely differ, so the version-skew failure can be reproduced
 * against the actual routing and error-boundary code rather than an imitation.
 *
 * The two builds differ by exactly one thing: a marker comment appended to
 * `StudioDashboard.tsx`. That is deliberate — the dashboard chunk is the chunk
 * the Owner's already-open page requests, so its hash MUST change between the
 * versions or the reproduction proves nothing. Each build also receives its own
 * `FOREVER_BUILD_ID`, which is what the shipped recovery path compares.
 *
 * The marker is appended in memory and the original file is restored
 * byte-for-byte in a `finally`, with a post-restore assertion. Nothing here
 * commits, pushes, deploys, reads a credential or touches production.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

/** The chunk whose hash must differ between the two versions. */
const MARKED_SOURCE = resolve(
  REPO_ROOT,
  "src/features/forever-studio/components/StudioDashboard.tsx",
);

/**
 * Harness-only Supabase configuration. These are syntactically valid but
 * deliberately non-resolving placeholders: the harness proves a client-side
 * module-load failure, which happens strictly before any data work, so no real
 * project reference, key or credential is needed or used.
 */
const HARNESS_ENV = {
  VITE_SUPABASE_URL: "https://staleassetharness.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_staleassetharness",
  SUPABASE_URL: "https://staleassetharness.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_staleassetharness",
  NITRO_PRESET: "node-server",
};

function log(message) {
  process.stdout.write(`[stale-asset-harness] ${message}\n`);
}

function buildOneVersion({ label, buildId, marker, outRoot, siteOrigin }) {
  const original = readFileSync(MARKED_SOURCE);
  try {
    // A COMMENT IS NOT ENOUGH. Comments are stripped before hashing, so two
    // builds that differ only by a comment ship byte-identical chunks and the
    // reproduction would prove nothing. This appends an observable side effect
    // on a global object, which the bundler cannot prove pure and therefore
    // cannot drop — so the dashboard chunk's content, and its hash, really
    // differ between the two versions.
    writeFileSync(
      MARKED_SOURCE,
      Buffer.concat([
        original,
        Buffer.from(
          `\nif (typeof document !== "undefined") {\n` +
            `  document.documentElement.dataset.foreverHarnessVersion = ${JSON.stringify(marker)};\n` +
            `}\n`,
          "utf8",
        ),
      ]),
    );

    const outputDir = resolve(REPO_ROOT, ".output");
    rmSync(outputDir, { recursive: true, force: true });

    log(`building ${label} (build id ${buildId})`);
    const result = spawnSync(
      process.execPath,
      [resolve(REPO_ROOT, "node_modules/vite/bin/vite.js"), "build"],
      {
        cwd: REPO_ROOT,
        stdio: "inherit",
        env: {
          ...process.env,
          ...HARNESS_ENV,
          VITE_PUBLIC_SITE_ORIGIN: siteOrigin,
          FOREVER_BUILD_ID: buildId,
        },
      },
    );
    if (result.status !== 0) {
      throw new Error(`${label} build failed with exit code ${result.status}`);
    }

    const versionDir = resolve(outRoot, label);
    rmSync(versionDir, { recursive: true, force: true });
    mkdirSync(versionDir, { recursive: true });
    cpSync(outputDir, versionDir, { recursive: true });
    log(`${label} captured at ${versionDir}`);
    return versionDir;
  } finally {
    writeFileSync(MARKED_SOURCE, original);
    const restored = readFileSync(MARKED_SOURCE);
    if (!restored.equals(original)) {
      throw new Error("harness failed to restore the marked source byte-for-byte");
    }
  }
}

function main() {
  const outRoot = resolve(
    process.env.FOREVER_STALE_ASSET_HARNESS_OUT ?? resolve(REPO_ROOT, ".stale-asset-harness"),
  );
  const siteOrigin = process.env.FOREVER_STALE_ASSET_HARNESS_ORIGIN ?? "http://localhost:4180";
  mkdirSync(outRoot, { recursive: true });

  buildOneVersion({
    label: "version-a",
    buildId: process.env.FOREVER_HARNESS_BUILD_ID_A ?? "aaaaaaaaaaaa",
    marker: "A",
    outRoot,
    siteOrigin,
  });
  buildOneVersion({
    label: "version-b",
    buildId: process.env.FOREVER_HARNESS_BUILD_ID_B ?? "bbbbbbbbbbbb",
    marker: "B",
    outRoot,
    siteOrigin,
  });

  for (const label of ["version-a", "version-b"]) {
    const assets = resolve(outRoot, label, "public/assets");
    if (!existsSync(assets)) throw new Error(`${label} produced no client asset directory`);
  }
  log(`done — versions written under ${outRoot}`);
}

main();
