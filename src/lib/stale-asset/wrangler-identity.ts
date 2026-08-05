/**
 * FOREVER-PR139-REVIEW-CORRECTIONS-001 — the EXACT repository-locked Wrangler
 * identity, resolved ONCE and consumed by every path that may launch Wrangler.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS TO REMOVE (PR139 independent review, P1-1 and P2-1)
 * ---------------------------------------------------------------------------
 *
 * The previous gate resolved Wrangler as:
 *
 *   const chosen = override ? resolve(override) : existsSync(local) ? local : null;
 *
 * — so ANY executable named by `WRANGLER_BIN` was launched for a production
 * candidate upload provided it printed the string `4.118.0`. A version string
 * is output, not identity: a copy, a symlink, a repository-shaped path under a
 * different root, or a two-line script that prints `4.118.0` and then does
 * something else entirely all passed. The gate that existed to prove WHICH
 * Wrangler ran proved only what that Wrangler chose to say about itself.
 *
 * The same gate then wrote `resolvedFromRepository: Boolean(resolvedPath)` into
 * release evidence. That is true for every path that resolved at all, including
 * an external override — so the one field naming the provenance of the uploader
 * asserted repository provenance for an executable that had none.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ENFORCED NOW
 * ---------------------------------------------------------------------------
 *
 * 1. The canonical entry point is `node_modules/wrangler/bin/wrangler.js`,
 *    resolved RELATIVE TO THE REPOSITORY ROOT, and it is the only executable
 *    this module will ever authorize. There is no PATH lookup and no selectable
 *    alternative.
 * 2. Identity is FILESYSTEM identity: `realpathSync.native` on both sides and an
 *    exact comparison. A symlink, a copy, a hard link path or a different root
 *    that happens to end in `node_modules/wrangler/bin/wrangler.js` is a
 *    different real file and is refused.
 * 3. `node_modules/wrangler/package.json` must report EXACTLY the supported
 *    version. This is read from the installed tree, so a lockfile that says one
 *    thing while `node_modules` holds another is caught.
 * 4. The CLI must still REPORT exactly the supported version. Both checks are
 *    required: the manifest proves what is installed, the probe proves what
 *    actually executes.
 * 5. `WRANGLER_BIN` CANNOT SELECT ANYTHING. It is no longer an alternative
 *    resolution source; it is only ever an additional way to FAIL. If it is set
 *    and its canonical real path is not identical to the repository entry
 *    point, this module returns the named refusal
 *    `wrangler_override_not_identical` and NO launcher — so no upload-capable
 *    path is ever reached with it.
 *
 * There is deliberately NO `TEST_WRANGLER_BIN` or equivalent environment escape
 * hatch. Tests exercise rejection by calling `resolveRepositoryWrangler` with an
 * explicit `override` ARGUMENT — module-level dependency injection that a CLI
 * caller has no way to reach, because a CLI caller supplies no arguments.
 *
 * ---------------------------------------------------------------------------
 * ONE RESOLVER, BOTH PATHS
 * ---------------------------------------------------------------------------
 *
 * `scripts/release/wrangler-version-gate.mjs` — and therefore the production
 * upload wrapper, which consumes it — and `wrangler-identity.test.ts` both call
 * this module, so identity is decided in exactly one place for every path that
 * can reach an upload.
 *
 * FOREVER-STUDIO-EXPLICIT-BINDINGS-FIX-002 removed the third caller. The
 * offline multipart-serialization proof asserted that Wrangler forwards a
 * pinned `inherit` `version_id` verbatim. It did, and the production API
 * refused the result with HTTP 400 [code: 10057]: the proof measured Wrangler
 * where the open question was Cloudflare. It was deleted with the mechanism it
 * defended rather than left as evidence for a path no release can take.
 *
 * Nothing here reads a credential, contacts a network or performs an upload.
 * The single spawn is `--version`, under a minimal synthetic environment.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import { buildContainedChildEnv, createIsolatedConfigRoot } from "./contained-child-environment";
import {
  SUPPORTED_WRANGLER_VERSION,
  parseWranglerVersionOutput,
  verifyWranglerVersion,
} from "./worker-variable-preservation";

/**
 * The ONE entry point, repository-relative.
 *
 * Mutation control 27 replaces this constant to prove a PATH-shaped value
 * cannot be substituted for the repository-locked file.
 */
export const CANONICAL_WRANGLER_ENTRY = "node_modules/wrangler/bin/wrangler.js";

/** The installed manifest whose `version` must equal the supported version. */
export const WRANGLER_PACKAGE_MANIFEST = "node_modules/wrangler/package.json";

/** Shims that cannot be launched without a shell, and are never worked around. */
const SHELL_SHIM = /\.(?:cmd|bat|ps1)$/i;

export type WranglerIdentityRefusal =
  | "wrangler_not_installed"
  | "wrangler_entry_unresolvable"
  | "wrangler_entry_requires_shell"
  | "wrangler_package_manifest_unreadable"
  | "wrangler_package_version_mismatch"
  | "wrangler_override_unresolvable"
  | "wrangler_override_not_identical"
  | "wrangler_version_not_reported"
  | "wrangler_version_mismatch";

/**
 * The sanitized identity record written into release evidence.
 *
 * Every field is a boolean or a version string. No filesystem path, credential,
 * account identifier or binding value appears here or in the JSON the gate
 * emits — a local path is not evidence, and a path that named a user directory
 * would be worse than useless in a shared artefact.
 */
export interface WranglerIdentityEvidence {
  /** TRUE only when the repository-locked entry point passed real-path identity. */
  readonly canonicalRepositoryPathAccepted: boolean;
  /** TRUE when `WRANGLER_BIN` (or an injected override) was supplied at all. */
  readonly overrideRequested: boolean;
  /** TRUE only when a supplied override IS the canonical file, byte-for-byte the same inode. */
  readonly overrideAccepted: boolean;
  /** TRUE when an override was supplied and refused. Mutually exclusive with the above. */
  readonly overrideRejected: boolean;
  /** `node_modules/wrangler/package.json` version, or null when unreadable. */
  readonly packageVersion: string | null;
  /** What the CLI printed for `--version`, or null when not probed or unparseable. */
  readonly reportedVersion: string | null;
  /** The one version this release contract is written against. */
  readonly expectedVersion: string;
  /**
   * ACTUAL canonical path equality — never `Boolean(resolvedPath)`.
   *
   * TRUE if and only if the executable this result authorizes is the
   * repository-locked entry point, proven by `realpathSync` comparison. FALSE
   * for every refusal, including a rejected external override that reported the
   * supported version.
   */
  readonly resolvedFromRepository: boolean;
  /** The overall verdict, restated so a reader cannot assemble a partial one. */
  readonly identityOk: boolean;
}

/** A shell-free launcher: `spawn(command, [...prefixArgs, ...argv], { shell: false })`. */
export interface WranglerLauncher {
  readonly command: string;
  readonly prefixArgs: readonly string[];
}

export interface WranglerIdentity {
  readonly ok: boolean;
  readonly refusals: readonly WranglerIdentityRefusal[];
  readonly problems: readonly string[];
  /** Null on ANY refusal. There is no partially-authorized launcher. */
  readonly launcher: WranglerLauncher | null;
  /** The canonical real path, for the caller's own spawn. Never written to evidence. */
  readonly canonicalPath: string | null;
  readonly evidence: WranglerIdentityEvidence;
}

function canonicalRealPath(path: string): string | null {
  try {
    return (realpathSync.native ?? realpathSync)(path);
  } catch {
    return null;
  }
}

function refused(
  refusals: readonly WranglerIdentityRefusal[],
  problems: readonly string[],
  evidence: Partial<WranglerIdentityEvidence>,
): WranglerIdentity {
  return {
    ok: false,
    refusals,
    problems,
    launcher: null,
    canonicalPath: null,
    evidence: {
      canonicalRepositoryPathAccepted: false,
      overrideRequested: false,
      overrideAccepted: false,
      overrideRejected: false,
      packageVersion: null,
      reportedVersion: null,
      expectedVersion: SUPPORTED_WRANGLER_VERSION,
      resolvedFromRepository: false,
      identityOk: false,
      ...evidence,
    },
  };
}

/**
 * Resolves the ONE Wrangler this repository may run, FAIL-CLOSED.
 *
 * `override` is a plain argument, not an environment read. The production gate
 * passes `process.env.WRANGLER_BIN` so a stale operator override STOPS the
 * release loudly instead of silently selecting a foreign executable; the tests
 * pass a fixture path so rejection is proven behaviourally. Neither can make
 * this function return a launcher for anything other than the canonical file.
 */
export function resolveRepositoryWrangler(input: {
  readonly repoRoot: string;
  readonly override?: string | null;
}): WranglerIdentity {
  const canonicalEntry = resolve(input.repoRoot, CANONICAL_WRANGLER_ENTRY);
  const overrideRaw = typeof input.override === "string" ? input.override.trim() : "";
  const overrideRequested = overrideRaw.length > 0;

  if (!existsSync(canonicalEntry)) {
    return refused(
      ["wrangler_not_installed"],
      [
        `the repository-locked Wrangler is not installed at ${CANONICAL_WRANGLER_ENTRY}. Run ` +
          `\`npm ci\` (wrangler@${SUPPORTED_WRANGLER_VERSION} is a locked devDependency). A PATH ` +
          "lookup is deliberately NOT attempted and no external installation is substitutable: a " +
          "production candidate upload is never performed by whichever Wrangler happens to exist.",
      ],
      { overrideRequested },
    );
  }

  const canonicalReal = canonicalRealPath(canonicalEntry);
  if (canonicalReal === null) {
    return refused(
      ["wrangler_entry_unresolvable"],
      ["the repository-locked Wrangler entry point could not be resolved to a real path."],
      { overrideRequested },
    );
  }
  if (SHELL_SHIM.test(canonicalReal)) {
    return refused(
      ["wrangler_entry_requires_shell"],
      [
        "the repository-locked Wrangler resolved to a .cmd/.bat/.ps1 shim, which cannot be " +
          "launched without a shell. Every spawn in this release path is `shell: false`.",
      ],
      { overrideRequested },
    );
  }

  let packageVersion: string | null = null;
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(input.repoRoot, WRANGLER_PACKAGE_MANIFEST), "utf8"),
    ) as { version?: unknown };
    packageVersion = typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    packageVersion = null;
  }
  if (packageVersion === null) {
    return refused(
      ["wrangler_package_manifest_unreadable"],
      [
        `${WRANGLER_PACKAGE_MANIFEST} could not be read, so the INSTALLED version is unknown. An ` +
          "unidentified installation is never used.",
      ],
      { overrideRequested },
    );
  }
  if (packageVersion !== SUPPORTED_WRANGLER_VERSION) {
    return refused(
      ["wrangler_package_version_mismatch"],
      [
        `the installed Wrangler package reports ${packageVersion}; this release contract is ` +
          `written against ${SUPPORTED_WRANGLER_VERSION} only.`,
      ],
      { overrideRequested, packageVersion },
    );
  }

  if (overrideRequested) {
    const overrideReal = canonicalRealPath(resolve(overrideRaw));
    if (overrideReal === null) {
      return refused(
        ["wrangler_override_unresolvable"],
        [
          "WRANGLER_BIN is set but does not resolve to an existing file. It cannot SELECT a " +
            "Wrangler in any case; it is accepted only when it names the repository-locked entry " +
            "point itself. Unset it.",
        ],
        { overrideRequested, overrideRejected: true, packageVersion },
      );
    }
    // THE P1-1 REFUSAL. Filesystem identity, not a reported version string: a
    // copy, a symlink target elsewhere, or a repository-shaped path under a
    // different root is a different real file and is refused even when it
    // prints exactly the supported version.
    if (overrideReal !== canonicalReal) {
      return refused(
        ["wrangler_override_not_identical"],
        [
          "WRANGLER_BIN names an executable that is NOT the repository-locked Wrangler. Matching " +
            "the supported version string is not identity — a copy, a symlink, or any external " +
            "installation that prints the same version is still a different file, and this " +
            "release path uploads with the locked file or with nothing.",
        ],
        { overrideRequested, overrideRejected: true, packageVersion },
      );
    }
  }

  return {
    ok: true,
    refusals: [],
    problems: [],
    // ALWAYS the canonical real path. An accepted override changes nothing
    // about what is launched, because an accepted override IS this file.
    launcher: { command: process.execPath, prefixArgs: [canonicalReal] },
    canonicalPath: canonicalReal,
    evidence: {
      canonicalRepositoryPathAccepted: true,
      overrideRequested,
      overrideAccepted: overrideRequested,
      overrideRejected: false,
      packageVersion,
      reportedVersion: null,
      expectedVersion: SUPPORTED_WRANGLER_VERSION,
      resolvedFromRepository: true,
      identityOk: true,
    },
  };
}

/** The shape a probe spawn must return. Matches `spawnSync`'s relevant fields. */
export interface WranglerProbeResult {
  readonly status?: number | null;
  readonly stdout?: string | null;
  readonly stderr?: string | null;
  readonly error?: unknown;
}

/**
 * Resolves, then PROVES the resolved file reports exactly the supported version.
 *
 * The probe runs under a minimal synthetic environment built by
 * `contained-child-environment.ts`: `--version` needs no credential, no
 * operator Wrangler/OAuth configuration and no proxy, so it is given none.
 *
 * `spawnProbe` is a module-level injection point for tests. Production callers
 * pass nothing and get the real, shell-free `spawnSync`.
 */
export function verifyRepositoryWranglerIdentity(input: {
  readonly repoRoot: string;
  readonly override?: string | null;
  readonly spawnProbe?: (launcher: WranglerLauncher) => WranglerProbeResult;
}): WranglerIdentity {
  const resolved = resolveRepositoryWrangler(input);
  if (!resolved.ok || resolved.launcher === null) return resolved;

  const run = (input.spawnProbe ?? defaultVersionProbe)(resolved.launcher);
  if (run.error || typeof run.status !== "number" || run.status !== 0) {
    return refused(
      ["wrangler_version_not_reported"],
      ["the repository-locked Wrangler could not be executed to report its version."],
      {
        canonicalRepositoryPathAccepted: true,
        overrideRequested: resolved.evidence.overrideRequested,
        overrideAccepted: resolved.evidence.overrideAccepted,
        packageVersion: resolved.evidence.packageVersion,
      },
    );
  }

  const reportedVersion = parseWranglerVersionOutput(`${run.stdout ?? ""}\n${run.stderr ?? ""}`);
  const verdict = verifyWranglerVersion(reportedVersion);
  if (!verdict.ok) {
    return refused(
      [reportedVersion === null ? "wrangler_version_not_reported" : "wrangler_version_mismatch"],
      verdict.reasons,
      {
        canonicalRepositoryPathAccepted: true,
        overrideRequested: resolved.evidence.overrideRequested,
        overrideAccepted: resolved.evidence.overrideAccepted,
        packageVersion: resolved.evidence.packageVersion,
        reportedVersion,
      },
    );
  }

  return {
    ...resolved,
    evidence: { ...resolved.evidence, reportedVersion },
  };
}

function defaultVersionProbe(launcher: WranglerLauncher): WranglerProbeResult {
  const isolated = createIsolatedConfigRoot("forever-wrangler-version-probe-");
  try {
    return spawnSync(launcher.command, [...launcher.prefixArgs, "--version"], {
      encoding: "utf8",
      shell: false,
      env: buildContainedChildEnv({ isolated }),
    });
  } finally {
    isolated.dispose();
  }
}
