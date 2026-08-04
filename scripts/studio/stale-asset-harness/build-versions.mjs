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
 * `FOREVER_CLIENT_ASSET_ID`, which is what the shipped recovery path compares.
 *
 * The marker is appended in memory and the original file is restored
 * byte-for-byte in a `finally`, with a post-restore assertion. Nothing here
 * commits, pushes, deploys, reads a credential or touches production.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SUPABASE_STUB_ORIGIN } from "./supabase-stub.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

/** The chunk whose hash must differ between the two versions. */
const MARKED_SOURCE = resolve(
  REPO_ROOT,
  "src/features/forever-studio/components/StudioDashboard.tsx",
);

/**
 * Harness-only Supabase configuration — a LOCAL STUB, not a placeholder.
 *
 * CORRECTED (narrow-re-review RR2-P2-2). This block used to point at
 * `https://staleassetharness.supabase.co` with the stated rationale that "a
 * module-load failure happens strictly before any data work, so no real project
 * reference, key or credential is needed". That rationale was MEASURED WRONG:
 * `/` has a loader that fetches the featured project list during server
 * rendering, the placeholder host is `ENOTFOUND`, SSR threw, and every scenario
 * started from an HTTP 500 document with no React route mounted. Scenarios that
 * asserted "no recovery screen appeared" therefore passed by nothing happening.
 *
 * The builds now point at `scripts/studio/stale-asset-harness/supabase-stub.mjs`
 * on loopback, which answers the public read paths with an empty result set. No
 * credential and no real project are needed or used — that part was always true
 * — but a data plane that ANSWERS is, because the proof has to run against a
 * real application document that returned 200 and a router that actually
 * booted. `npm run build` sets none of these.
 */
const HARNESS_ENV = {
  VITE_SUPABASE_URL: SUPABASE_STUB_ORIGIN,
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_staleassetharness",
  SUPABASE_URL: SUPABASE_STUB_ORIGIN,
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_staleassetharness",
  NITRO_PRESET: "node-server",
  // The two-version harness pins each version's identity ON PURPOSE, so the
  // switchable origin can prove a specific transition. That is a manual
  // override, which a PRODUCTION build now refuses outright
  // (independent-review P3-3), so the harness must state the explicitly
  // non-production guard. `npm run build` never sets it.
  FOREVER_ALLOW_TEST_CLIENT_ASSET_ID: "1",
  // Exposes the read-mostly harness seam. Never set by `npm run build`.
  VITE_FOREVER_STALE_ASSET_HARNESS: "1",
};

function log(message) {
  process.stdout.write(`[stale-asset-harness] ${message}\n`);
}

function buildOneVersion({ label, clientAssetId, marker, outRoot, siteOrigin }) {
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

    log(`building ${label} (build id ${clientAssetId})`);
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
          FOREVER_CLIENT_ASSET_ID: clientAssetId,
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
    clientAssetId: process.env.FOREVER_HARNESS_CLIENT_ASSET_ID_A ?? "aaaaaaaaaaaa",
    marker: "A",
    outRoot,
    siteOrigin,
  });
  buildOneVersion({
    label: "version-b",
    clientAssetId: process.env.FOREVER_HARNESS_CLIENT_ASSET_ID_B ?? "bbbbbbbbbbbb",
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
