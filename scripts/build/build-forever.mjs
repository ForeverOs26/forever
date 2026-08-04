#!/usr/bin/env node
/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the output-derived production
 * build (independent-review P1-4).
 *
 * `npm run build` is THIS, not a bare `vite build`, because the public build
 * identity is derived from the EMITTED OUTPUT and cannot be known before that
 * output exists.
 *
 *   BUILD         emit the whole runtime graph with the fixed canonical
 *                 PLACEHOLDER identity inlined;
 *   DIGEST        hash the complete emitted runtime graph in deterministic
 *                 sorted order — client JS, client CSS, static assets, route
 *                 chunks, generated route output, and the server/Worker runtime
 *                 output — normalising only the placeholder identity bytes and
 *                 the content-hash segments they would move;
 *   DERIVE        identity = 128 bits of SHA-256 of that digest;
 *   SEAL          substitute the derived identity for the placeholder IN PLACE,
 *                 byte-for-byte and same-length, in the already-emitted files;
 *   SELF-VERIFY   normalise the derived identity back to the placeholder,
 *                 recompute the digest over the SEALED output, and REQUIRE
 *                 exact equality and an unchanged file count. Then require the
 *                 placeholder to be gone.
 *
 * ---------------------------------------------------------------------------
 * WHY SEALING IN PLACE RATHER THAN A LITERAL SECOND BUILD
 * ---------------------------------------------------------------------------
 *
 * A literal two-pass rebuild was implemented first and MEASURED against this
 * repository. It cannot self-verify, and the reason is instructive: inlining a
 * different identity changes the client entry chunk's content, therefore its
 * content hash, therefore the start manifest, therefore the module ordering of
 * the SERVER bundle — and Rolldown's identifier deconfliction then renames
 * unrelated local bindings (measured: `import process from "node:process"` in
 * one pass, `import processModule from "node:process"` in the other, inside
 * `server/_chunks/run.mjs`, a file that contains no identity at all). Those are
 * consequences of rebuilding, not facts about the application, and no
 * normalisation can honestly erase them.
 *
 * Sealing in place removes the second build entirely. The substitution is the
 * same number of bytes in the same positions of the same files, so NOTHING
 * else can move — and the self-verification proves exactly that: the sealed
 * output normalises back to the digest the identity was derived from, the file
 * count is unchanged, and the placeholder is gone. The identity therefore
 * describes the bytes that actually ship, which is the whole requirement.
 *
 * Nothing here deploys, publishes, reads a credential or touches production.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url, { interopDefault: true });

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const OUTPUT = resolve(REPO_ROOT, ".output");
const RECORD_DIR = resolve(REPO_ROOT, ".forever-build");
const IDENTITY_RECORD = resolve(RECORD_DIR, "identity.json");

const {
  FOREVER_BUILD_ID_DERIVED_ENV,
  FOREVER_BUILD_ID_PLACEHOLDER,
  FOREVER_BUILD_ID_PLACEHOLDER_ENV,
  deriveForeverBuildId,
  digestEmittedOutput,
  emittedTextFiles,
  sealForeverBuildIdInPlace,
} = await jiti.import("./forever-build-id.ts");

function log(message) {
  process.stdout.write(`[forever-build] ${message}\n`);
}

function viteBuild() {
  log("building with the placeholder identity…");
  const result = spawnSync(
    process.execPath,
    [resolve(REPO_ROOT, "node_modules/vite/bin/vite.js"), "build", ...process.argv.slice(2)],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        // A manual override can never reach a production build.
        FOREVER_BUILD_ID: undefined,
        FOREVER_ALLOW_TEST_BUILD_ID: undefined,
        [FOREVER_BUILD_ID_DERIVED_ENV]: undefined,
        [FOREVER_BUILD_ID_PLACEHOLDER_ENV]: "1",
      },
    },
  );
  if (result.status !== 0) throw new Error(`build failed with exit code ${result.status}`);
  if (!existsSync(resolve(OUTPUT, "public/assets"))) {
    throw new Error("build produced no client asset directory");
  }
}

function main() {
  rmSync(RECORD_DIR, { recursive: true, force: true });
  mkdirSync(RECORD_DIR, { recursive: true });
  rmSync(OUTPUT, { recursive: true, force: true });

  viteBuild();

  const before = digestEmittedOutput(OUTPUT, FOREVER_BUILD_ID_PLACEHOLDER);
  if (before.fileCount === 0) {
    throw new Error("the build emitted no files — refusing to derive an identity from nothing");
  }
  log(`normalised output digest ${before.digest.slice(0, 16)}… over ${before.fileCount} files`);

  const identity = deriveForeverBuildId(before.digest);
  log(`derived FOREVER_BUILD_ID = ${identity}`);

  const sealed = sealForeverBuildIdInPlace(OUTPUT, identity);
  if (sealed.clientOccurrences === 0) {
    throw new Error(
      "the derived identity was not inlined into any CLIENT asset — a running page could not " +
        "state which build it came from, so recovery could never fire",
    );
  }
  if (sealed.serverOccurrences === 0) {
    throw new Error(
      "the derived identity was not inlined into any SERVER output — /forever-build.json could " +
        "not report the active build, so recovery could never fire",
    );
  }
  log(
    `sealed ${sealed.totalOccurrences} occurrence(s) across ${sealed.filesTouched} file(s) ` +
      `(client ${sealed.clientOccurrences}, server ${sealed.serverOccurrences})`,
  );

  // ---- SELF-VERIFICATION --------------------------------------------------
  const after = digestEmittedOutput(OUTPUT, identity);
  if (after.fileCount !== before.fileCount) {
    throw new Error(
      `sealing changed the emitted file count (${before.fileCount} → ${after.fileCount}) — ` +
        "the identity does not describe what ships",
    );
  }
  if (after.digest !== before.digest) {
    throw new Error(
      "FINAL OUTPUT DID NOT REPRODUCE THE DERIVED IDENTITY.\n" +
        `  digest the identity was derived from: ${before.digest}\n` +
        `  digest of the sealed output:          ${after.digest}\n` +
        "The build identity would not describe the emitted runtime graph, so automatic " +
        "stale-asset recovery could not trust it. Refusing to ship.",
    );
  }
  const leftovers = emittedTextFiles(OUTPUT).filter((entry) =>
    entry.contents.includes(FOREVER_BUILD_ID_PLACEHOLDER),
  );
  if (leftovers.length > 0) {
    throw new Error(
      `the placeholder identity still appears in ${leftovers.length} emitted file(s) — refusing ` +
        "to ship output that reports a placeholder as its build",
    );
  }
  log("self-verification PASSED — the sealed output reproduces the identity it carries");

  writeFileSync(
    IDENTITY_RECORD,
    `${JSON.stringify(
      {
        foreverBuildId: identity,
        normalizedOutputDigest: before.digest,
        emittedFileCount: before.fileCount,
        sealedOccurrences: sealed.totalOccurrences,
        selfVerified: true,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  log(`done — ${identity}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[forever-build] FAILED: ${error.message}\n`);
  process.exitCode = 1;
}
