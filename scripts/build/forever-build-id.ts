/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — public build identity.
 *
 * The recovery path has to answer one question before it is allowed to reload a
 * page under someone: "is the build serving this origin RIGHT NOW a different
 * build from the one this page is running?" Without that answer, a reload is a
 * guess — and a guess that is wrong reloads a page for an ordinary error.
 *
 * The identifier below is that answer's input. It is inlined at build time into
 * BOTH the client bundle and the server bundle of the same build, so:
 *
 *   - the constant compiled into the running page states the build that page
 *     came from;
 *   - the same constant, served by whichever build is active, states the build
 *     the origin is serving now;
 *   - they are equal for one immutable build and differ across a release.
 *
 * WHAT IT IS NOT. Not a secret, not a credential, not a token, not a GitHub
 * reference, not a path, and not derived from any production system. It is a
 * short digest of this repository's own build inputs — publishable by
 * construction, because it is exactly as public as the asset filenames it
 * accompanies.
 *
 * REPRODUCIBILITY. The repository already treats a build that cannot be
 * reproduced as a defect (see the `compatibility_date` reasoning in
 * wrangler.jsonc). So the identifier is never a timestamp and never random: the
 * same source produces the same identifier on every machine, and a release can
 * pin it explicitly through `FOREVER_BUILD_ID`.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/**
 * The shape every consumer may assume: lowercase alphanumerics, at most 32
 * characters. Bounded on purpose — this value crosses into the browser and into
 * a public JSON response, so it can never grow into a place to hide detail.
 */
export const FOREVER_BUILD_ID_PATTERN = /^[a-z0-9]{1,32}$/;

/** The value used when no build-time identity is available (dev server, tests). */
export const FOREVER_BUILD_ID_FALLBACK = "development";

export function isBoundedForeverBuildId(value: unknown): value is string {
  return typeof value === "string" && FOREVER_BUILD_ID_PATTERN.test(value);
}

/** Build inputs outside `src/` that change what the bundler emits. */
const EXTRA_INPUTS = ["package.json", "package-lock.json", "vite.config.ts", "tsconfig.json"];

/** Never contributes to what ships, and would only add churn. */
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", ".output", "dist"]);

function collectFiles(root: string, directory: string, into: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries.sort()) {
    if (IGNORED_DIRECTORIES.has(entry)) continue;
    const full = join(directory, entry);
    let isDirectory = false;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) collectFiles(root, full, into);
    else into.push(relative(root, full).split(sep).join("/"));
  }
}

/**
 * A deterministic digest of this repository's build inputs.
 *
 * Path AND content are hashed, so a rename is a different build even when the
 * bytes are unchanged. The list is sorted, so filesystem enumeration order
 * cannot influence the result.
 */
function digestSourceTree(repositoryRoot: string): string {
  const files: string[] = [];
  collectFiles(repositoryRoot, resolve(repositoryRoot, "src"), files);
  for (const extra of EXTRA_INPUTS) files.push(extra);

  const hash = createHash("sha256");
  for (const relativePath of files.sort()) {
    let contents: Buffer;
    try {
      contents = readFileSync(resolve(repositoryRoot, relativePath));
    } catch {
      continue;
    }
    hash.update(relativePath);
    hash.update("\u0000");
    hash.update(contents);
    hash.update("\u0000");
  }
  return hash.digest("hex").slice(0, 12);
}

/**
 * Resolves the identifier for the build now starting.
 *
 * An explicit `FOREVER_BUILD_ID` wins so a release can pin a reviewed value,
 * but it must satisfy the bounded pattern — a malformed override is ignored
 * rather than shipped, because a build identity that is not bounded is worse
 * than one that is merely derived.
 */
export function resolveForeverBuildId(
  repositoryRoot: string,
  environment: Record<string, string | undefined> = process.env,
): string {
  const explicit = environment.FOREVER_BUILD_ID?.trim().toLowerCase();
  if (isBoundedForeverBuildId(explicit)) return explicit;
  return digestSourceTree(repositoryRoot);
}
