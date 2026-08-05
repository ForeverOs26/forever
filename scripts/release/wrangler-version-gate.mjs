#!/usr/bin/env node
/**
 * FOREVER-PR138-MERGE-BLOCKER-CORRECTION-002 — the Wrangler version gate.
 * Corrected by FOREVER-PR139-REVIEW-CORRECTIONS-001 (P1-1, P2-1).
 *
 * The independent review recorded, as a verified limitation, that nothing in
 * this repository pinned a Wrangler version: a release would have used whatever
 * Wrangler happened to be on the operator's PATH. `--keep-vars` semantics, the
 * `keep_vars` schema key and the version-detail response shape were all
 * verified against ONE version, so any other one is unverified by everything
 * here — and this correction exists precisely because an unverified assumption
 * was treated as a guarantee.
 *
 * THE PR139 CORRECTION. Pinning the VERSION was not pinning the WRANGLER. This
 * gate used to resolve `WRANGLER_BIN` ahead of the repository install and then
 * accept whatever it was, provided it printed `4.118.0` — so any external
 * executable that reported the right string was launched for a production
 * candidate upload. It then wrote the evidence field `resolvedFromRepository`
 * as a bare truthiness test over the resolved path, which asserted repository
 * provenance for that external executable too.
 *
 * Identity now lives in ONE place — `src/lib/stale-asset/wrangler-identity.ts` —
 * and is filesystem identity, not a version string. This gate is a thin CLI over
 * it, and the offline serialization proof calls the same module, so "the version
 * we proved things about" and "the version that uploads" are the same FILE.
 *
 * This gate therefore does two things and refuses to do a third:
 *
 *   1. it RESOLVES Wrangler to the exact repository-locked entry point, proven
 *      by `realpathSync` comparison, with the installed package manifest
 *      required to report the supported version;
 *   2. it PROVES the resolved Wrangler reports exactly that version;
 *   3. it never falls back to a PATH lookup and never SELECTS an alternative, so
 *      "whichever wrangler is installed" is not a reachable state.
 *
 * `WRANGLER_BIN` can no longer choose anything. If it is set, it is checked, and
 * anything that is not canonically the repository entry point is a named STOP
 * before an upload-capable path is reached.
 *
 * CLI
 *   node scripts/release/wrangler-version-gate.mjs [--json <out.json>]
 *
 * EXIT CODES
 *   0  the repository-locked Wrangler is present and is exactly the supported version
 *   1  STOP — not the locked file, not installed, or the wrong version
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createJiti } from "jiti";

const REPO = process.cwd();
const jiti = createJiti(import.meta.url);

const contract = await jiti.import(
  resolve(REPO, "src/lib/stale-asset/worker-variable-preservation.ts"),
);
const identity = await jiti.import(resolve(REPO, "src/lib/stale-asset/wrangler-identity.ts"));

export const { SUPPORTED_WRANGLER_VERSION, parseWranglerVersionOutput, verifyWranglerVersion } =
  contract;
const { resolveRepositoryWrangler, verifyRepositoryWranglerIdentity } = identity;

/**
 * Resolves the one Wrangler this release is allowed to run.
 *
 * Returns a launcher, never a shell string: `{ command, prefixArgs }` is fed
 * straight to `spawnSync(command, [...prefixArgs, ...argv], { shell: false })`.
 *
 * `WRANGLER_BIN` is read here and ONLY here, and it is passed to the shared
 * resolver as an override to be CHECKED — never as an alternative to be chosen.
 */
export function resolveWrangler(repo = REPO) {
  return resolveRepositoryWrangler({ repoRoot: repo, override: process.env.WRANGLER_BIN });
}

/** Resolves, then probes `--version` with `shell: false` and compares EXACTLY. */
export function probeWranglerVersion(repo = REPO) {
  const result = verifyRepositoryWranglerIdentity({
    repoRoot: repo,
    override: process.env.WRANGLER_BIN,
  });
  return {
    ok: result.ok,
    problems: result.problems,
    refusals: result.refusals,
    launcher: result.launcher,
    resolvedPath: result.canonicalPath,
    reportedVersion: result.evidence.reportedVersion,
    supportedVersion: result.evidence.expectedVersion,
    evidence: result.evidence,
  };
}

const invokedDirectly =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href ||
  process.argv[1]?.endsWith("wrangler-version-gate.mjs");

if (invokedDirectly) {
  const result = probeWranglerVersion();
  const log = (message) => process.stdout.write(`[wrangler-gate] ${message}\n`);
  log(`supported version : ${result.supportedVersion}`);
  log(`package version   : ${result.evidence.packageVersion ?? "(none)"}`);
  log(`reported version  : ${result.reportedVersion ?? "(none)"}`);
  log(`repository-locked : ${result.evidence.resolvedFromRepository}`);
  log(`override requested: ${result.evidence.overrideRequested}`);
  log(`shell             : false`);

  const jsonIndex = process.argv.indexOf("--json");
  if (jsonIndex !== -1 && process.argv[jsonIndex + 1]) {
    writeFileSync(
      resolve(REPO, process.argv[jsonIndex + 1]),
      // Booleans and version strings only. The resolved path is a local
      // filesystem path, not evidence, and is never written into a shared
      // artefact — but `resolvedFromRepository` is now the REAL canonical-path
      // equality result rather than `Boolean(resolvedPath)`, so a rejected
      // external override can no longer be recorded as repository-resolved.
      `${JSON.stringify(
        {
          supportedVersion: result.supportedVersion,
          packageVersion: result.evidence.packageVersion,
          reportedVersion: result.reportedVersion,
          canonicalRepositoryPathAccepted: result.evidence.canonicalRepositoryPathAccepted,
          overrideRequested: result.evidence.overrideRequested,
          overrideAccepted: result.evidence.overrideAccepted,
          overrideRejected: result.evidence.overrideRejected,
          resolvedFromRepository: result.evidence.resolvedFromRepository,
          identityOk: result.evidence.identityOk,
          shell: false,
          ok: result.ok,
          refusals: result.refusals,
          problems: result.problems,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  if (!result.ok) {
    for (const problem of result.problems) {
      process.stderr.write(`[wrangler-gate] STOP: ${problem}\n`);
    }
    process.exit(1);
  }
  log(`PASS — the repository-locked Wrangler ${result.reportedVersion} is the supported version.`);
}
