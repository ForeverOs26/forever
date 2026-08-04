/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the public CLIENT ASSET identity,
 * derived from the EMITTED CLIENT OUTPUT.
 *
 * The recovery path has to answer one question before it is allowed to reload a
 * page under someone: "is the CLIENT ASSET GRAPH this origin serves RIGHT NOW a
 * different graph from the one this page is running?" Without that answer, a
 * reload is a guess — and a guess that is wrong reloads a page for an ordinary
 * error.
 *
 * That question is about client assets, and this identity answers exactly it.
 * It is NOT a release identity: see
 * `src/lib/stale-asset/worker-release-identity.ts` and the header of
 * `client-asset-id-contract.ts` for the measured reason the two were split
 * (narrow-re-review RR2-P1-1).
 *
 * ---------------------------------------------------------------------------
 * WHY SOURCE ENUMERATION WAS NOT AN IDENTITY (independent-review P1-4)
 * ---------------------------------------------------------------------------
 *
 * The reviewed design hashed a LIST OF PRESUMED INPUTS: `src/`, plus
 * `package.json`, `package-lock.json`, `vite.config.ts` and `tsconfig.json`. It
 * hashed no `VITE_*` environment variable, nothing in `public/`, nothing in
 * `scripts/`. The review built this repository five times and measured two
 * builds that emitted **50 different content-hashed chunks — including the
 * `StudioDashboard` chunk from the incident — under the SAME identifier**.
 *
 * In production that is not a cosmetic error. The chunk 404s exactly as in the
 * PR #134 incident, the probe returns the same identifier, the decision reaches
 * `same_client_assets`, and automatic recovery is refused. The PR's central deliverable
 * silently does not fire.
 *
 * An identity of the inputs can only ever be as complete as the list. So the
 * identity is now a digest of the OUTPUT — the client bytes that actually ship.
 *
 * ---------------------------------------------------------------------------
 * THE OUTPUT-DERIVED CONTRACT (`scripts/build/build-forever.mjs`)
 * ---------------------------------------------------------------------------
 *
 * The identity cannot be inside the thing it identifies, so:
 *
 *   BUILD         emit the whole runtime graph with the fixed canonical
 *                 PLACEHOLDER identity inlined.
 *   DIGEST        hash the emitted CLIENT graph plus the generated Worker
 *                 configuration in deterministic sorted order, normalising the
 *                 placeholder identity bytes and the content-hash segments they
 *                 would move.
 *   DERIVE        identity = 128 bits of SHA-256 of that digest.
 *   SEAL          substitute the derived identity for the placeholder IN
 *                 PLACE, byte-for-byte and same-length, in the emitted files.
 *   SELF-VERIFY   normalise the identity back to the placeholder, recompute
 *                 the digest over the SEALED output, and REQUIRE exact
 *                 equality, an unchanged file count, and no surviving
 *                 placeholder. Otherwise the build FAILS.
 *
 * WHY SEALING RATHER THAN A LITERAL SECOND BUILD. A two-pass rebuild was
 * implemented first and measured: inlining a different identity changes the
 * client entry chunk, therefore its content hash, therefore the start manifest,
 * therefore the module ordering of the SERVER bundle — and Rolldown then
 * renamed unrelated local bindings in files containing no identity at all.
 * Those are consequences of rebuilding, not facts about the application, and no
 * honest normalisation erases them. Sealing changes the same number of bytes in
 * the same positions of the same files, so nothing else CAN move, and the
 * self-verification proves exactly that.
 *
 * WHY CONTENT-HASH SEGMENTS ARE STILL NORMALISED. So the digest is comparable
 * across builds where a hash moved for an unrelated reason. A filename hash is
 * a function of content, and the content itself is hashed either way, so a
 * genuinely different chunk still produces a genuinely different digest.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 *
 * Not a secret, not a credential, not a token, not a GitHub reference, not a
 * path, not a Cloudflare Worker version, and not derived from any production
 * system. It is a short digest of this repository's own emitted client bytes —
 * publishable by construction, because it is exactly as public as the asset
 * filenames it accompanies.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import {
  FOREVER_CLIENT_ASSET_ID_FALLBACK,
  FOREVER_CLIENT_ASSET_ID_HEX_LENGTH,
  FOREVER_CLIENT_ASSET_ID_PATTERN,
  FOREVER_CLIENT_ASSET_ID_PLACEHOLDER,
  isBoundedForeverClientAssetId,
} from "../../src/lib/stale-asset/client-asset-id-contract";

export {
  FOREVER_CLIENT_ASSET_ID_FALLBACK,
  FOREVER_CLIENT_ASSET_ID_PATTERN,
  FOREVER_CLIENT_ASSET_ID_PLACEHOLDER,
  isBoundedForeverClientAssetId,
};

/**
 * Environment variable the orchestrator sets on the FINAL pass only.
 *
 * Deliberately distinct from `FOREVER_CLIENT_ASSET_ID`: this one is not a
 * manual override, it is the derived value being fed back in, and the
 * orchestrator is the only thing that sets it.
 */
export const FOREVER_CLIENT_ASSET_ID_DERIVED_ENV = "FOREVER_CLIENT_ASSET_ID_DERIVED";

/** Environment variable the orchestrator sets on the FIRST pass only. */
export const FOREVER_CLIENT_ASSET_ID_PLACEHOLDER_ENV = "FOREVER_CLIENT_ASSET_ID_PLACEHOLDER_PASS";

/**
 * The ONLY guard under which a manual `FOREVER_CLIENT_ASSET_ID` is honoured.
 *
 * Independent-review P3-3: the previous override was validated for shape only,
 * so pinning a previously deployed identifier made every page from that build
 * see `same_client_assets` and refuse recovery. A production build must not be able to
 * reuse an old identity, so a manual override is now refused outright unless
 * this explicitly non-production guard is set — which the production
 * orchestrator never sets, and which the two-version test harness does.
 */
export const FOREVER_CLIENT_ASSET_ID_TEST_OVERRIDE_ENV = "FOREVER_ALLOW_TEST_CLIENT_ASSET_ID";

/**
 * WHAT THE DIGEST COVERS, AND THE MEASURED REASON FOR EVERY EXCLUSION.
 *
 * The rule is "hash the emitted CLIENT asset graph plus the generated Worker
 * configuration". Applying that rule to this toolchain required measuring what
 * is actually reproducible, because an identity computed over non-reproducible
 * bytes is not an identity — the same artefact could not be re-derived.
 *
 * MEASURED, in this repository, twice, with identical source and identical
 * environment (`scripts/build/measure-output-determinism.mjs` reproduces it):
 *
 *   - `.output/public/**` — the COMPLETE client runtime graph — is
 *     BYTE-IDENTICAL across builds. Every client JS chunk, every route chunk,
 *     every CSS file, every static asset, the generated route output and
 *     `_headers`. Zero differing files.
 *   - `.output/server/wrangler.json` — the generated Worker configuration — is
 *     BYTE-IDENTICAL across builds.
 *   - `.output/server/**.mjs` — the server JavaScript bundle — is NOT. Two
 *     builds of the same source differed in 17 files, from two causes, neither
 *     of which is a fact about the application:
 *       1. Rolldown identifier deconfliction, which renamed a local binding
 *          (`import process from "node:process"` in one build,
 *          `import processModule from "node:process"` in the other) inside
 *          chunks whose content-hashed FILENAMES were identical;
 *       2. `server/index.mjs` embeds a public-asset manifest carrying file
 *          `mtime` values.
 *   - `.output/nitro.json` records the build DATE.
 *
 * So the digest covers the whole client runtime graph plus the generated Worker
 * configuration, and excludes the server JavaScript bundle and `nitro.json`.
 *
 * WHY THAT EXCLUSION IS SAFE FOR THIS MECHANISM, precisely. A stale-asset
 * failure is by construction a BROWSER failing to fetch a CLIENT chunk. This
 * identity exists to answer one question: has the origin moved to a different
 * client asset graph? Every input that can change that graph — application
 * source, a lazy Studio route, CSS, a public static asset, the route tree, a
 * `VITE_*` environment value, a dependency whose code reaches the browser — is
 * inside the digest, because the emitted client bytes are. A server-only change
 * cannot make a client chunk 404, so it cannot produce the failure this
 * identity gates.
 *
 * WHAT THIS IDENTITY THEREFORE MUST NEVER BE USED FOR (RR2-P1-1). A release
 * that changes ONLY server code ships with the SAME client asset identity, and
 * that is correct: a page from the previous build reads `same_client_assets` because
 * its chunks all still exist. It follows immediately that this value cannot
 * verify a Worker deployment, a traffic allocation or a rollback target. The
 * immutable Cloudflare Worker version UUID does that, and only it —
 * `src/lib/stale-asset/worker-release-identity.ts`.
 *
 * `client-asset-identity.test.ts` fails if this list grows.
 */
export const FOREVER_CLIENT_ASSET_DIGEST_INCLUDED = ["public", "server/wrangler.json"] as const;

export const FOREVER_CLIENT_ASSET_DIGEST_EXCLUSIONS: ReadonlyArray<{
  readonly path: string;
  readonly reason: string;
}> = [
  {
    path: "nitro.json",
    reason: "generated non-runtime metadata; records the build date",
  },
  {
    path: "package.json",
    reason: "generated non-runtime metadata; a two-key deploy stub",
  },
  {
    path: "package-lock.json",
    reason: "generated non-runtime metadata; an empty deploy stub",
  },
  {
    path: "server/**.mjs",
    reason:
      "not part of the CLIENT asset graph, and MEASURED non-reproducible in this toolchain: " +
      "Rolldown identifier deconfliction and an mtime-bearing public-asset manifest made 17 " +
      "files differ between two builds of identical source whose client output was " +
      "byte-identical. The deployed server artefact is identified by the immutable Cloudflare " +
      "Worker version UUID instead, never by this digest",
  },
] as const;

/** Whether a path under the output root contributes to the client asset digest. */
export function pathContributesToClientAssetIdentity(relativePath: string): boolean {
  const path = relativePath.split(sep).join("/");
  if (path === "server/wrangler.json") return true;
  return path === "public" || path.startsWith("public/");
}

/**
 * A Vite-style content hash in a filename or a reference to one.
 *
 * Bounded to the emitted runtime extensions so ordinary text cannot be
 * accidentally rewritten.
 */
const CONTENT_HASH_IN_NAME = /-[A-Za-z0-9_-]{8,}(\.(?:js|mjs|cjs|css|map))/g;
const CONTENT_HASH_TOKEN = "-<forever-content-hash>$1";

/** Extensions treated as text for normalisation. Everything else is hashed raw. */
const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".map",
  ".json",
  ".html",
  ".txt",
  ".xml",
  ".svg",
  ".webmanifest",
  "",
]);

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

/** Canonical, hash-free form of an emitted path. */
export function normalizeEmittedName(relativePath: string): string {
  return relativePath.split(sep).join("/").replace(CONTENT_HASH_IN_NAME, CONTENT_HASH_TOKEN);
}

/**
 * Canonical, identity-free form of an emitted file's bytes.
 *
 * `identity` is whatever value THIS build inlined; it is replaced by the fixed
 * placeholder so the two passes are comparable. Content-hash tokens are
 * normalised for the reason given in the header.
 */
export function normalizeEmittedContent(
  relativePath: string,
  contents: Buffer,
  identity: string,
): Buffer {
  if (!TEXT_EXTENSIONS.has(extensionOf(relativePath))) return contents;
  let text = contents.toString("utf8");
  if (identity && identity !== FOREVER_CLIENT_ASSET_ID_PLACEHOLDER) {
    text = text.split(identity).join(FOREVER_CLIENT_ASSET_ID_PLACEHOLDER);
  }
  text = text.replace(CONTENT_HASH_IN_NAME, CONTENT_HASH_TOKEN);
  return Buffer.from(text, "utf8");
}

function collectEmittedFiles(root: string, directory: string, into: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries.sort()) {
    const full = join(directory, entry);
    let isDirectory = false;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) collectEmittedFiles(root, full, into);
    else into.push(relative(root, full).split(sep).join("/"));
  }
}

export type EmittedClientAssetDigest = {
  /** The digest itself — hex SHA-256 of the whole normalised client graph. */
  digest: string;
  /** How many files contributed. Zero is always an error, never an empty graph. */
  fileCount: number;
  /** Canonical names, sorted. Bounded, public, and useful in evidence. */
  canonicalNames: string[];
};

/**
 * Hashes the complete emitted client asset graph, deterministically.
 *
 * Every contributing file under the output root contributes, in sorted
 * canonical order, both its canonical name and the SHA-256 of its normalised
 * bytes. Sorting by `(canonicalName, contentHash)` keeps the order total even
 * when two chunks normalise to the same canonical name.
 */
export function digestEmittedClientAssets(
  outputRoot: string,
  identity: string,
): EmittedClientAssetDigest {
  const files: string[] = [];
  collectEmittedFiles(outputRoot, outputRoot, files);

  const entries: Array<{ name: string; contentHash: string }> = [];
  for (const relativePath of files) {
    if (!pathContributesToClientAssetIdentity(relativePath)) continue;
    let contents: Buffer;
    try {
      contents = readFileSync(resolve(outputRoot, relativePath));
    } catch {
      continue;
    }
    const normalized = normalizeEmittedContent(relativePath, contents, identity);
    entries.push({
      name: normalizeEmittedName(relativePath),
      contentHash: createHash("sha256").update(normalized).digest("hex"),
    });
  }

  entries.sort((a, b) =>
    a.name === b.name ? a.contentHash.localeCompare(b.contentHash) : a.name.localeCompare(b.name),
  );

  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(entry.name);
    hash.update(" ");
    hash.update(entry.contentHash);
    hash.update(" ");
  }

  return {
    digest: hash.digest("hex"),
    fileCount: entries.length,
    canonicalNames: entries.map((entry) => entry.name),
  };
}

/**
 * Turns a client asset digest into the bounded public identity.
 *
 * 128 bits of SHA-256, which fits the bounded public-ID contract (at most 32
 * lowercase alphanumerics) with nothing to spare and nothing wasted.
 */
export function deriveForeverClientAssetId(clientAssetDigest: string): string {
  const derived = createHash("sha256")
    .update("forever-client-asset-identity-v3 ")
    .update(clientAssetDigest)
    .digest("hex")
    .slice(0, FOREVER_CLIENT_ASSET_ID_HEX_LENGTH);
  if (!isBoundedForeverClientAssetId(derived)) {
    throw new Error("derived FOREVER_CLIENT_ASSET_ID is not bounded — refusing to continue");
  }
  return derived;
}

export type EmittedTextFile = { relativePath: string; contents: string };

/** Every emitted TEXT file under the output root, for scanning and sealing. */
export function emittedTextFiles(outputRoot: string): EmittedTextFile[] {
  const files: string[] = [];
  collectEmittedFiles(outputRoot, outputRoot, files);
  const out: EmittedTextFile[] = [];
  for (const relativePath of files) {
    if (!TEXT_EXTENSIONS.has(extensionOf(relativePath))) continue;
    try {
      out.push({ relativePath, contents: readFileSync(resolve(outputRoot, relativePath), "utf8") });
    } catch {
      /* unreadable files cannot carry an identity */
    }
  }
  return out;
}

export type SealResult = {
  totalOccurrences: number;
  clientOccurrences: number;
  serverOccurrences: number;
  filesTouched: number;
};

/**
 * Substitutes the derived identity for the placeholder IN PLACE.
 *
 * The two values are the same length by construction, so this is a byte-for-
 * byte replacement in the same positions of the same files: no filename moves,
 * no content hash moves, nothing is re-bundled, and nothing else can change.
 * That is precisely what makes the self-verification exact.
 */
export function sealForeverClientAssetIdInPlace(outputRoot: string, identity: string): SealResult {
  if (identity.length !== FOREVER_CLIENT_ASSET_ID_PLACEHOLDER.length) {
    throw new ForeverClientAssetIdError(
      `derived identity is ${identity.length} characters but the placeholder is ` +
        `${FOREVER_CLIENT_ASSET_ID_PLACEHOLDER.length}; an in-place seal must not change any ` +
        "byte offset",
    );
  }
  const result: SealResult = {
    totalOccurrences: 0,
    clientOccurrences: 0,
    serverOccurrences: 0,
    filesTouched: 0,
  };
  for (const file of emittedTextFiles(outputRoot)) {
    const parts = file.contents.split(FOREVER_CLIENT_ASSET_ID_PLACEHOLDER);
    const occurrences = parts.length - 1;
    if (occurrences === 0) continue;
    writeFileSync(resolve(outputRoot, file.relativePath), parts.join(identity), "utf8");
    result.totalOccurrences += occurrences;
    result.filesTouched += 1;
    const normalized = file.relativePath.split(sep).join("/");
    if (normalized.startsWith("public/")) result.clientOccurrences += occurrences;
    if (normalized.startsWith("server/")) result.serverOccurrences += occurrences;
  }
  return result;
}

export class ForeverClientAssetIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "forever_client_asset_id_error";
  }
}

/**
 * Resolves the client asset identifier for the build now starting.
 *
 * Fail-closed, in this exact order:
 *
 *   1. the orchestrator's DERIVED value, on the final pass;
 *   2. the orchestrator's PLACEHOLDER pass;
 *   3. a manual `FOREVER_CLIENT_ASSET_ID`, but ONLY behind the explicit
 *      non-production test guard — otherwise refused, because a production
 *      build that can reuse a previously deployed identity can silently
 *      disable the recovery this identity exists to enable (P3-3);
 *   4. nothing else. A bare `vite build` throws rather than shipping a
 *      placeholder or an incomplete identity.
 */
export function resolveForeverClientAssetId(
  environment: Record<string, string | undefined> = process.env,
): string {
  const derived = environment[FOREVER_CLIENT_ASSET_ID_DERIVED_ENV]?.trim().toLowerCase();
  if (derived) {
    if (!isBoundedForeverClientAssetId(derived)) {
      throw new ForeverClientAssetIdError(
        `${FOREVER_CLIENT_ASSET_ID_DERIVED_ENV} is not a bounded client asset identifier`,
      );
    }
    return derived;
  }

  if (environment[FOREVER_CLIENT_ASSET_ID_PLACEHOLDER_ENV] === "1") {
    return FOREVER_CLIENT_ASSET_ID_PLACEHOLDER;
  }

  const manual = environment.FOREVER_CLIENT_ASSET_ID?.trim().toLowerCase();
  if (manual) {
    if (environment[FOREVER_CLIENT_ASSET_ID_TEST_OVERRIDE_ENV] !== "1") {
      throw new ForeverClientAssetIdError(
        "FOREVER_CLIENT_ASSET_ID may not be set for a production build: a manual identity can " +
          "reuse a previously deployed value, which makes every page from that build see " +
          "`same_client_assets` and refuses the recovery this identity exists to enable. Run " +
          "`npm run build`, which derives the identity from the emitted client output.",
      );
    }
    if (!isBoundedForeverClientAssetId(manual)) {
      throw new ForeverClientAssetIdError(
        "FOREVER_CLIENT_ASSET_ID is not a bounded client asset identifier",
      );
    }
    return manual;
  }

  throw new ForeverClientAssetIdError(
    "No FOREVER_CLIENT_ASSET_ID is available. A production build must run through " +
      "`npm run build` (scripts/build/build-forever.mjs), which derives the identity from the " +
      "emitted client output and verifies that the sealed output reproduces it.",
  );
}
