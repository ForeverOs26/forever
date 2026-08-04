#!/usr/bin/env node
/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — reproduces the build-determinism
 * measurement that scopes the identity digest (independent-review P1-4).
 *
 * Runs TWO builds with identical source and identical environment and reports,
 * per output area, how many emitted files differ. The claim it exists to keep
 * honest is in `scripts/build/forever-build-id.ts`:
 *
 *   - the whole CLIENT runtime graph is byte-identical across builds;
 *   - the generated Worker configuration is byte-identical across builds;
 *   - the server JavaScript bundle is NOT, for reasons that are not facts about
 *     the application.
 *
 * If that ever stops being true — in either direction — this script says so,
 * and the exclusion in the digest should be revisited. Exits non-zero when the
 * client graph or the Worker configuration is not reproducible, because the
 * identity would then not be reproducible either.
 *
 * Nothing here deploys, publishes, reads a credential or touches production.
 */

import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const OUTPUT = resolve(REPO_ROOT, ".output");
const SCRATCH = resolve(REPO_ROOT, ".forever-build/determinism");

function log(message) {
  process.stdout.write(`[determinism] ${message}\n`);
}

function build(label, extraEnv = {}) {
  log(`building ${label}…`);
  const result = spawnSync(
    process.execPath,
    [resolve(REPO_ROOT, "node_modules/vite/bin/vite.js"), "build"],
    {
      cwd: REPO_ROOT,
      stdio: "ignore",
      env: {
        ...process.env,
        FOREVER_BUILD_ID: undefined,
        FOREVER_ALLOW_TEST_BUILD_ID: undefined,
        FOREVER_BUILD_ID_DERIVED: undefined,
        FOREVER_BUILD_ID_PLACEHOLDER_PASS: "1",
        ...extraEnv,
      },
    },
  );
  if (result.status !== 0) throw new Error(`${label} build failed (${result.status})`);
  const target = resolve(SCRATCH, label);
  rmSync(target, { recursive: true, force: true });
  cpSync(OUTPUT, target, { recursive: true });
  return target;
}

function fileMap(root) {
  const map = new Map();
  const walk = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const relativePath = relative(root, full).split(sep).join("/");
      map.set(relativePath, createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  walk(root);
  return map;
}

function compare(a, b, predicate) {
  const names = new Set([...a.keys(), ...b.keys()].filter(predicate));
  const differing = [];
  for (const name of [...names].sort()) {
    if (a.get(name) !== b.get(name)) differing.push(name);
  }
  return { total: names.size, differing };
}

function main() {
  rmSync(SCRATCH, { recursive: true, force: true });
  const first = fileMap(build("run-a"));
  const second = fileMap(build("run-b"));

  const client = compare(first, second, (name) => name.startsWith("public/"));
  const workerConfig = compare(first, second, (name) => name === "server/wrangler.json");
  const serverJs = compare(first, second, (name) => /^server\/.*\.(mjs|js|cjs)$/.test(name));
  const metadata = compare(first, second, (name) => name === "nitro.json");

  log(`client runtime graph : ${client.total} files, ${client.differing.length} differing`);
  log(`generated Worker cfg : ${workerConfig.total} files, ${workerConfig.differing.length} differing`);
  log(`server JavaScript    : ${serverJs.total} files, ${serverJs.differing.length} differing`);
  log(`build metadata       : ${metadata.total} files, ${metadata.differing.length} differing`);
  for (const name of serverJs.differing) log(`  server differs: ${name}`);

  let failed = false;
  if (client.total === 0) {
    log("FAIL: no client files were compared — the measurement proves nothing");
    failed = true;
  }
  if (client.differing.length > 0) {
    log("FAIL: the CLIENT runtime graph is not reproducible, so the identity is not either");
    for (const name of client.differing) log(`  client differs: ${name}`);
    failed = true;
  }
  if (workerConfig.differing.length > 0) {
    log("FAIL: the generated Worker configuration is not reproducible");
    failed = true;
  }
  if (serverJs.differing.length === 0) {
    log(
      "NOTE: the server JavaScript bundle was reproducible in this run. The documented exclusion " +
        "may no longer be necessary — re-run a few times before widening the digest.",
    );
  }

  rmSync(SCRATCH, { recursive: true, force: true });
  if (failed) process.exitCode = 1;
  else log("PASS: everything the identity digest covers is reproducible");
}

try {
  main();
} catch (error) {
  process.stderr.write(`[determinism] FAILED: ${error.message}\n`);
  process.exitCode = 1;
}
