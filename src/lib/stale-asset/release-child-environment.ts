/**
 * FOREVER-PR140-CORRECTIONS-002 — the environment each release CHILD process is
 * given, with the two release inputs removed.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS TO REMOVE (PR140 independent review, F2)
 * ---------------------------------------------------------------------------
 *
 * The upload wrapper is the one process permitted to hold `SUPABASE_URL` and
 * `STUDIO_STORAGE_WRITE_PROVIDER`. It read them from
 * `FOREVER_RELEASE_SUPABASE_URL` and
 * `FOREVER_RELEASE_STUDIO_STORAGE_WRITE_PROVIDER` — and then spawned both of its
 * children with `{ ...process.env, ... }`, so both inherited those variables
 * verbatim:
 *
 *   - the PREUPLOAD preflight, whose entire design premise is that it never sees
 *     a value and reasons only about a value-free projection. It was handed both
 *     values in its environment and simply did not read them, which is not the
 *     same property;
 *   - the Wrangler upload child, which needs the values only through the
 *     verified ephemeral specification named by `--config`. A second, unverified
 *     copy in the environment is a path nothing checks: Wrangler resolves
 *     `${VAR}`-style references and reads `.env`/`.dev.vars` files, so an
 *     environment copy is a real alternative source rather than dead weight.
 *
 * Neither child needs either variable. This module constructs their environments
 * explicitly and DELETES both keys, so the containment the runbook claims is a
 * property of the environment object rather than of what the child happens to do
 * with it.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS AND IS NOT DONE HERE
 * ---------------------------------------------------------------------------
 *
 * This is NOT `contained-child-environment.ts`. That module builds a minimal
 * allowlisted environment for an OFFLINE proof, where nothing of the operator's
 * shell may travel. A production release child is different: the preflight needs
 * the operator's real Node and OS environment, and Wrangler needs the operator's
 * real Cloudflare credentials. So this module is a targeted REMOVAL on top of
 * the inherited environment, and it says so rather than implying an allowlist.
 *
 * `auditReleaseChildEnv` is the same contract expressed as a check, so a test can
 * assert it against the environment a real child process actually observed —
 * never against the intent of this file, and never by quoting a value.
 */

import { RELEASE_VALUE_ENV_VARS } from "./explicit-plain-text-bindings";

/**
 * The release-input variables no child process may inherit.
 *
 * Derived from the contract rather than re-listed: renaming an input there
 * renames it here, and a new one is stripped without this file being edited.
 */
export const RELEASE_VALUE_ENV_KEYS = Object.values(RELEASE_VALUE_ENV_VARS);

/**
 * Wrangler's output-DIRECTORY override.
 *
 * The upload child is given an exact output FILE path. An operator-set directory
 * override would make Wrangler write its structured result somewhere the wrapper
 * does not read, and the wrapper would then report "no documented structured
 * upload result" for an upload that actually succeeded. Removed, not merged.
 */
export const WRANGLER_OUTPUT_DIRECTORY_ENV_KEY = "WRANGLER_OUTPUT_FILE_DIRECTORY";

/** Wrangler's output-FILE override, which the wrapper sets deliberately. */
export const WRANGLER_OUTPUT_FILE_ENV_KEY = "WRANGLER_OUTPUT_FILE_PATH";

/** Copies a parent environment, dropping absent values and every named key. */
function inheritWithout(
  parentEnv: Readonly<Record<string, string | undefined>>,
  removed: readonly string[],
): Record<string, string> {
  const dropped = new Set(removed);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (dropped.has(key)) continue;
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

/**
 * The environment for the PREUPLOAD verification child.
 *
 * The preflight is handed a value-free projection on the command line and must
 * reach a verdict without ever being able to read a value. Both release inputs
 * are therefore deleted, so "this process was never given a value" is true of
 * the process, not merely of its code path.
 */
export function buildPreuploadChildEnv(input: {
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
}): Record<string, string> {
  return {
    ...inheritWithout(input.parentEnv, RELEASE_VALUE_ENV_KEYS),
    NO_COLOR: "1",
  };
}

/**
 * The environment for the Wrangler upload child.
 *
 * Wrangler receives the two values through ONE channel — the verified ephemeral
 * specification named by `--config` — and through nothing else. The release
 * inputs are deleted, and so is the output-directory override the wrapper does
 * not control.
 */
export function buildUploadChildEnv(input: {
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  /** Absolute path Wrangler must write its structured result to. */
  readonly outputFilePath: string;
}): Record<string, string> {
  return {
    ...inheritWithout(input.parentEnv, [
      ...RELEASE_VALUE_ENV_KEYS,
      WRANGLER_OUTPUT_DIRECTORY_ENV_KEY,
    ]),
    [WRANGLER_OUTPUT_FILE_ENV_KEY]: input.outputFilePath,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  };
}

export interface ReleaseChildEnvFinding {
  readonly code: "release_value_env_present" | "wrangler_output_directory_present";
  readonly key: string;
  readonly detail: string;
}

/**
 * Audits an environment a release child ACTUALLY observed.
 *
 * Takes a plain record rather than reading `process.env`, so a behavioural test
 * can pass back exactly what a spawned child reported about itself. A finding
 * NEVER carries a value — reporting the leak by reprinting it would move the
 * value into the very output this whole design keeps it out of.
 */
export function auditReleaseChildEnv(
  observed: Readonly<Record<string, string | undefined>>,
  options: { readonly forbidWranglerOutputDirectory?: boolean } = {},
): { readonly ok: boolean; readonly findings: readonly ReleaseChildEnvFinding[] } {
  const findings: ReleaseChildEnvFinding[] = [];

  for (const key of RELEASE_VALUE_ENV_KEYS) {
    if (key in observed) {
      findings.push({
        code: "release_value_env_present",
        key,
        detail: `${key} reached a release child process. Its value is not reported.`,
      });
    }
  }

  if (
    options.forbidWranglerOutputDirectory === true &&
    WRANGLER_OUTPUT_DIRECTORY_ENV_KEY in observed
  ) {
    findings.push({
      code: "wrangler_output_directory_present",
      key: WRANGLER_OUTPUT_DIRECTORY_ENV_KEY,
      detail:
        `${WRANGLER_OUTPUT_DIRECTORY_ENV_KEY} reached the upload child, so Wrangler could write ` +
        "its structured result somewhere the wrapper does not read.",
    });
  }

  return { ok: findings.length === 0, findings };
}
