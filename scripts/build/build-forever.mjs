#!/usr/bin/env node
/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the output-derived production
 * build (independent-review P1-4, narrow-re-review RR2-P1-1 / RR2-P3-1).
 *
 * `npm run build` is THIS, not a bare `vite build`, because the public CLIENT
 * ASSET identity is derived from the EMITTED CLIENT OUTPUT and cannot be known
 * before that output exists.
 *
 *   BUILD         emit the whole runtime graph with the fixed canonical
 *                 PLACEHOLDER identity inlined;
 *   DIGEST        hash the emitted CLIENT ASSET GRAPH in deterministic sorted
 *                 order — client JS, client CSS, route/lazy chunks, public
 *                 static assets, generated route output and `_headers` — plus
 *                 the generated Worker configuration `server/wrangler.json`,
 *                 normalising only the placeholder identity bytes and the
 *                 content-hash segments they would move;
 *   DERIVE        identity = 128 bits of SHA-256 of that digest;
 *   SEAL          substitute the derived identity for the placeholder IN PLACE,
 *                 byte-for-byte and same-length, in the already-emitted files;
 *   SELF-VERIFY   normalise the derived identity back to the placeholder,
 *                 recompute the digest over the SEALED output, and REQUIRE
 *                 exact equality and an unchanged file count. Then require the
 *                 placeholder to be gone;
 *   MANIFEST      write a LOCAL, sanitized release manifest recording what this
 *                 build actually is — source commit, source tree, client asset
 *                 identity, compatibility date, non-secret config digest.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE DIGEST DOES AND DOES NOT COVER — stated accurately (RR2-P3-1)
 * ---------------------------------------------------------------------------
 *
 * This header used to claim the digest covered "the server/Worker runtime
 * output". It does not, and never did. It covers the CLIENT asset graph plus
 * the GENERATED WORKER CONFIGURATION. The server JavaScript bundle is excluded,
 * with the measured reasons recorded in
 * `scripts/build/forever-client-asset-id.ts`.
 *
 * The consequence is a contract, not a caveat: a release that changes ONLY
 * server code ships the SAME client asset identity — correctly, because no
 * chunk an open page holds can 404 — and therefore this identity CANNOT verify
 * a Worker deployment, a traffic allocation or a rollback target. The immutable
 * Cloudflare Worker version UUID does that, and only it. Nothing in this script
 * manufactures such a UUID, because nothing local can: it exists only once an
 * authorized `wrangler versions upload` has returned one.
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
 * describes the client bytes that actually ship, which is the whole
 * requirement.
 *
 * Nothing here deploys, publishes, uploads, reads a credential or touches
 * production.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const RELEASE_MANIFEST = resolve(RECORD_DIR, "release-manifest.json");

const {
  FOREVER_CLIENT_ASSET_ID_DERIVED_ENV,
  FOREVER_CLIENT_ASSET_ID_PLACEHOLDER,
  FOREVER_CLIENT_ASSET_ID_PLACEHOLDER_ENV,
  deriveForeverClientAssetId,
  digestEmittedClientAssets,
  emittedTextFiles,
  sealForeverClientAssetIdInPlace,
} = await jiti.import("./forever-client-asset-id.ts");

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
        FOREVER_CLIENT_ASSET_ID: undefined,
        FOREVER_ALLOW_TEST_CLIENT_ASSET_ID: undefined,
        [FOREVER_CLIENT_ASSET_ID_DERIVED_ENV]: undefined,
        [FOREVER_CLIENT_ASSET_ID_PLACEHOLDER_ENV]: "1",
      },
    },
  );
  if (result.status !== 0) throw new Error(`build failed with exit code ${result.status}`);
  if (!existsSync(resolve(OUTPUT, "public/assets"))) {
    throw new Error("build produced no client asset directory");
  }
}

/** Best-effort Git fact. A build outside a checkout records `unavailable`. */
function gitFact(args) {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.status !== 0) return "unavailable";
  return result.stdout.trim() || "unavailable";
}

/**
 * The canonical, NON-SECRET configuration surface of the generated Worker.
 *
 * Digested rather than copied so the manifest carries a comparable fingerprint
 * without republishing binding names and settings verbatim. `vars` is dropped
 * defensively: this repository declares none on purpose, and a future one must
 * not be able to leak a deployment-set value into a local artefact.
 */
function canonicalConfigFingerprint() {
  const path = resolve(OUTPUT, "server/wrangler.json");
  if (!existsSync(path)) return { fingerprint: "unavailable", compatibilityDate: "unavailable" };
  const config = JSON.parse(readFileSync(path, "utf8"));
  const { vars: _vars, ...rest } = config;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return {
    fingerprint: createHash("sha256").update(canonical).digest("hex").slice(0, 32),
    compatibilityDate:
      typeof config.compatibility_date === "string" ? config.compatibility_date : "unavailable",
  };
}

/**
 * The LOCAL release manifest (RR2-P1-1).
 *
 * It states what this build IS. It deliberately does NOT state which Worker
 * version will serve it, because no local process can know that: the immutable
 * Cloudflare Worker version UUID exists only after an authorized
 * `wrangler versions upload`, and it is added to the release evidence at that
 * point, never here. `workerVersionId` is therefore hard-wired to `null` and
 * the document carries its own limitation so it cannot be misread as a release
 * record. `src/lib/stale-asset/worker-release-identity.ts` pins that shape.
 */
function writeReleaseManifest(clientAssetId) {
  const { fingerprint, compatibilityDate } = canonicalConfigFingerprint();
  const manifest = {
    kind: "forever-local-release-manifest",
    sourceCommit: gitFact(["rev-parse", "HEAD"]),
    sourceTree: gitFact(["rev-parse", "HEAD^{tree}"]),
    clientAssetId,
    compatibilityDate,
    configFingerprint: fingerprint,
    workerVersionId: null,
    isNotAWorkerReleaseIdentity: true,
    workerVersionIdSource: "cloudflare-versions-upload",
  };
  writeFileSync(RELEASE_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  log(
    `release manifest written — commit ${manifest.sourceCommit.slice(0, 12)}, tree ` +
      `${manifest.sourceTree.slice(0, 12)}, client assets ${clientAssetId}, worker version ` +
      "null (assigned by Cloudflare on upload)",
  );
}

function main() {
  rmSync(RECORD_DIR, { recursive: true, force: true });
  mkdirSync(RECORD_DIR, { recursive: true });
  rmSync(OUTPUT, { recursive: true, force: true });

  viteBuild();

  const before = digestEmittedClientAssets(OUTPUT, FOREVER_CLIENT_ASSET_ID_PLACEHOLDER);
  if (before.fileCount === 0) {
    throw new Error("the build emitted no files — refusing to derive an identity from nothing");
  }
  log(`normalised client asset digest ${before.digest.slice(0, 16)}… over ${before.fileCount} files`);

  const identity = deriveForeverClientAssetId(before.digest);
  log(`derived FOREVER_CLIENT_ASSET_ID = ${identity}`);

  const sealed = sealForeverClientAssetIdInPlace(OUTPUT, identity);
  if (sealed.clientOccurrences === 0) {
    throw new Error(
      "the derived identity was not inlined into any CLIENT asset — a running page could not " +
        "state which client assets it came from, so recovery could never fire",
    );
  }
  if (sealed.serverOccurrences === 0) {
    throw new Error(
      "the derived identity was not inlined into any SERVER output — " +
        "/forever-client-assets.json could not report the active client asset graph, so " +
        "recovery could never fire",
    );
  }
  log(
    `sealed ${sealed.totalOccurrences} occurrence(s) across ${sealed.filesTouched} file(s) ` +
      `(client ${sealed.clientOccurrences}, server ${sealed.serverOccurrences})`,
  );

  // ---- SELF-VERIFICATION --------------------------------------------------
  const after = digestEmittedClientAssets(OUTPUT, identity);
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
        "The client asset identity would not describe the emitted client graph, so automatic " +
        "stale-asset recovery could not trust it. Refusing to ship.",
    );
  }
  const leftovers = emittedTextFiles(OUTPUT).filter((entry) =>
    entry.contents.includes(FOREVER_CLIENT_ASSET_ID_PLACEHOLDER),
  );
  if (leftovers.length > 0) {
    throw new Error(
      `the placeholder identity still appears in ${leftovers.length} emitted file(s) — refusing ` +
        "to ship output that reports a placeholder as its client asset identity",
    );
  }
  log("self-verification PASSED — the sealed output reproduces the identity it carries");

  writeFileSync(
    IDENTITY_RECORD,
    `${JSON.stringify(
      {
        foreverClientAssetId: identity,
        normalizedClientAssetDigest: before.digest,
        emittedFileCount: before.fileCount,
        sealedOccurrences: sealed.totalOccurrences,
        selfVerified: true,
        provesClientAssetCompatibilityOnly: true,
        workerReleaseIdentity: "cloudflare worker version uuid — assigned on upload, not here",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeReleaseManifest(identity);
  log(`done — ${identity}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[forever-build] FAILED: ${error.message}\n`);
  process.exitCode = 1;
}
