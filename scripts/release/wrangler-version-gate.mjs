#!/usr/bin/env node
/**
 * FOREVER-PR138-MERGE-BLOCKER-CORRECTION-002 — the Wrangler version gate.
 *
 * The independent review recorded, as a verified limitation, that nothing in
 * this repository pinned a Wrangler version: a release would have used whatever
 * Wrangler happened to be on the operator's PATH. `--keep-vars` semantics, the
 * `keep_vars` schema key and the version-detail response shape were all
 * verified against ONE version, so any other one is unverified by everything
 * here — and this correction exists precisely because an unverified assumption
 * was treated as a guarantee.
 *
 * This gate therefore does two things and refuses to do a third:
 *
 *   1. it RESOLVES Wrangler explicitly — a repository-local install, or an
 *      operator-supplied `WRANGLER_BIN`, and nothing else;
 *   2. it PROVES the resolved Wrangler reports exactly the supported version;
 *   3. it never falls back to a PATH lookup, so "whichever wrangler is
 *      installed" is not a reachable state.
 *
 * A `.cmd`, `.bat` or `.ps1` shim is refused rather than resolved: launching one
 * requires a shell, and every spawn in this release path is `shell: false`. The
 * `.js` entry point Wrangler ships is launched with this Node instead, which is
 * both shell-free and identical across platforms.
 *
 * CLI
 *   node scripts/release/wrangler-version-gate.mjs [--json <out.json>]
 *
 * EXIT CODES
 *   0  the resolved Wrangler is exactly the supported version
 *   1  STOP — not resolvable, not launchable without a shell, or wrong version
 */

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createJiti } from "jiti";

const REPO = process.cwd();
const jiti = createJiti(import.meta.url);

const contract = await jiti.import(
  resolve(REPO, "src/lib/stale-asset/worker-variable-preservation.ts"),
);

export const { SUPPORTED_WRANGLER_VERSION, parseWranglerVersionOutput, verifyWranglerVersion } =
  contract;

/** Entry points that can be launched without a shell. */
const NODE_ENTRY = /\.(?:js|mjs|cjs)$/;
/** Shims that CANNOT. Refused outright, never worked around by enabling a shell. */
const SHELL_SHIM = /\.(?:cmd|bat|ps1)$/i;

/**
 * Resolves the one Wrangler this release is allowed to run.
 *
 * Returns a launcher, never a shell string: `{ command, prefixArgs }` is fed
 * straight to `spawnSync(command, [...prefixArgs, ...argv], { shell: false })`.
 */
export function resolveWrangler(repo = REPO) {
  const problems = [];
  const override = process.env.WRANGLER_BIN;
  const local = resolve(repo, "node_modules/wrangler/bin/wrangler.js");

  const chosen = override ? resolve(override) : existsSync(local) ? local : null;

  if (!chosen) {
    problems.push(
      "Wrangler is not resolvable. Install it in this repository " +
        "(`npm i -D wrangler@" +
        `${SUPPORTED_WRANGLER_VERSION}\`) or set WRANGLER_BIN to the exact wrangler entry point. ` +
        "A PATH lookup is deliberately NOT attempted: a production candidate upload is never " +
        "performed by whichever Wrangler happens to be installed.",
    );
    return { ok: false, problems, launcher: null, resolvedPath: null };
  }
  if (SHELL_SHIM.test(chosen)) {
    problems.push(
      "the resolved Wrangler is a .cmd/.bat/.ps1 shim, which cannot be launched without a shell. " +
        "Point WRANGLER_BIN at wrangler's .js entry point instead.",
    );
    return { ok: false, problems, launcher: null, resolvedPath: chosen };
  }
  if (!existsSync(chosen)) {
    problems.push("the resolved Wrangler path does not exist.");
    return { ok: false, problems, launcher: null, resolvedPath: chosen };
  }

  const launcher = NODE_ENTRY.test(chosen)
    ? { command: process.execPath, prefixArgs: [chosen] }
    : { command: chosen, prefixArgs: [] };

  return { ok: true, problems, launcher, resolvedPath: chosen };
}

/** Probes `--version` with `shell: false` and compares it EXACTLY. */
export function probeWranglerVersion(repo = REPO) {
  const resolved = resolveWrangler(repo);
  if (!resolved.ok) {
    return { ...resolved, reportedVersion: null, supportedVersion: SUPPORTED_WRANGLER_VERSION };
  }

  const run = spawnSync(resolved.launcher.command, [...resolved.launcher.prefixArgs, "--version"], {
    cwd: repo,
    encoding: "utf8",
    shell: false,
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (run.error || typeof run.status !== "number" || run.status !== 0) {
    return {
      ok: false,
      problems: ["the resolved Wrangler could not be executed to report its version."],
      launcher: resolved.launcher,
      resolvedPath: resolved.resolvedPath,
      reportedVersion: null,
      supportedVersion: SUPPORTED_WRANGLER_VERSION,
    };
  }

  const reportedVersion = parseWranglerVersionOutput(`${run.stdout ?? ""}\n${run.stderr ?? ""}`);
  const verdict = verifyWranglerVersion(reportedVersion);
  return {
    ok: verdict.ok,
    problems: verdict.reasons,
    launcher: resolved.launcher,
    resolvedPath: resolved.resolvedPath,
    reportedVersion,
    supportedVersion: SUPPORTED_WRANGLER_VERSION,
  };
}

const invokedDirectly =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href ||
  process.argv[1]?.endsWith("wrangler-version-gate.mjs");

if (invokedDirectly) {
  const result = probeWranglerVersion();
  const log = (message) => process.stdout.write(`[wrangler-gate] ${message}\n`);
  log(`supported version : ${result.supportedVersion}`);
  log(`reported version  : ${result.reportedVersion ?? "(none)"}`);
  log(`shell             : false`);

  const jsonIndex = process.argv.indexOf("--json");
  if (jsonIndex !== -1 && process.argv[jsonIndex + 1]) {
    writeFileSync(
      resolve(REPO, process.argv[jsonIndex + 1]),
      // The resolved path is a local filesystem path, not evidence — it is
      // reported as a boolean rather than written into a shared artefact.
      `${JSON.stringify(
        {
          supportedVersion: result.supportedVersion,
          reportedVersion: result.reportedVersion,
          resolvedFromRepository: Boolean(result.resolvedPath),
          shell: false,
          ok: result.ok,
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
  log(`PASS — Wrangler ${result.reportedVersion} is the supported version.`);
}
