/**
 * FOREVER-PR139-REVIEW-CORRECTIONS-001 — wiring for the process-level
 * loopback-exclusive network guard.
 *
 * The guard itself is `loopback-network-guard.cjs`, preloaded into a child with
 * `node --require`. This module knows where it lives, how to configure it and
 * how to read back its sanitized decision log; it is imported by the offline
 * serialization proof and by the negative canary so both use ONE guard.
 *
 * `--require` is passed as a direct Node argument rather than through
 * `NODE_OPTIONS`. That avoids quoting a path through an environment string, and
 * it lets the contained child environment keep `NODE_OPTIONS` ABSENT — so the
 * behavioural environment test can assert the parent's `NODE_OPTIONS` did not
 * travel, instead of having to allow for one this file put there.
 *
 * The guard file is TRACKED SOURCE, reviewable and mutation-controllable. What
 * it writes — the decision log — is a throwaway file in a temporary directory
 * and is removed with the rest of the workspace.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The guard's repository-relative location.
 *
 * Stated as a constant rather than derived from `import.meta.url`: this module
 * is loaded by the Vitest transform, where `import.meta.url` is not a file URL,
 * and by `jiti`, where it is. A repository-relative path resolves identically
 * under both, and matches how every other release script names a file.
 */
export const LOOPBACK_GUARD_REPOSITORY_PATH = "src/lib/stale-asset/loopback-network-guard.cjs";

/** Absolute path to the preloadable guard. */
export const LOOPBACK_GUARD_PATH = resolve(process.cwd(), LOOPBACK_GUARD_REPOSITORY_PATH);

/** The named code every guard refusal carries. Asserted, never matched loosely. */
export const LOOPBACK_GUARD_BLOCKED_CODE = "FOREVER_LOOPBACK_GUARD_BLOCKED";

/** One sanitized decision. Destination metadata only — no path, header or body. */
export interface LoopbackGuardRecord {
  readonly api: string;
  readonly host: string;
  readonly port: number;
  readonly allowed: boolean;
}

/**
 * The Node arguments that install the guard, ahead of the child's entry point.
 *
 * Returned as data so a caller writes
 * `spawn(node, [...loopbackGuardNodeArgs(), entry, ...argv])` and cannot get
 * the ordering wrong.
 */
export function loopbackGuardNodeArgs(): readonly string[] {
  return ["--require", LOOPBACK_GUARD_PATH];
}

/** The environment the guard reads. Merged into a contained child environment. */
export function loopbackGuardEnv(input: {
  readonly allowedPort: number;
  readonly logPath: string;
}): Record<string, string> {
  return {
    FOREVER_LOOPBACK_GUARD_PORT: String(input.allowedPort),
    FOREVER_LOOPBACK_GUARD_LOG: input.logPath,
  };
}

/**
 * Reads the sanitized decision log.
 *
 * A missing file means the guard made no decision — which for a child that was
 * supposed to perform network activity is itself a finding, and the callers
 * assert on it rather than treating an empty log as success.
 */
export function readLoopbackGuardLog(logPath: string): readonly LoopbackGuardRecord[] {
  let raw: string;
  try {
    raw = readFileSync(logPath, "utf8");
  } catch {
    return [];
  }
  const records: LoopbackGuardRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as Partial<LoopbackGuardRecord>;
      records.push({
        api: String(parsed.api ?? ""),
        host: String(parsed.host ?? ""),
        port: Number(parsed.port ?? 0),
        allowed: parsed.allowed === true,
      });
    } catch {
      // A truncated final line is not a decision. Ignored rather than guessed.
    }
  }
  return records;
}

/** Every destination the guard refused. The canary asserts this is non-empty. */
export function blockedDestinations(
  records: readonly LoopbackGuardRecord[],
): readonly LoopbackGuardRecord[] {
  return records.filter((entry) => !entry.allowed);
}

/** Every destination the guard permitted. Always loopback, always one port. */
export function allowedDestinations(
  records: readonly LoopbackGuardRecord[],
): readonly LoopbackGuardRecord[] {
  return records.filter((entry) => entry.allowed);
}
