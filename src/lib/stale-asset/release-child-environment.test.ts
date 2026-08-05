/**
 * FOREVER-PR140-CORRECTIONS-002 — the two release children never receive a
 * release input, proven by ASKING A REAL CHILD PROCESS.
 *
 * PR140 independent review, F2: the upload wrapper held
 * `FOREVER_RELEASE_SUPABASE_URL` and
 * `FOREVER_RELEASE_STUDIO_STORAGE_WRITE_PROVIDER`, then spawned both of its
 * children with `{ ...process.env }`. The PREUPLOAD preflight — whose stated
 * property is that it is never given a value — received both, and so did
 * Wrangler, which resolves `${VAR}` references and reads `.env`/`.dev.vars` and
 * therefore had a second, unverified source for values that are supposed to
 * arrive through exactly one channel.
 *
 * A source-text assertion (`expect(wrapper).toContain("delete env...")`) proves
 * that characters exist. So every claim here is measured instead:
 *
 *   - a REAL child process is spawned with the environment the production
 *     builders produce, and it reports back its own `process.env`;
 *   - the same probe is run once with the UNSANITIZED environment, so the probe
 *     is shown to be capable of seeing the keys it reports as absent. Without
 *     that control, "no keys found" would be indistinguishable from a probe that
 *     never looks;
 *   - the wrapper end-to-end case — the real `upload-worker-version.mjs`
 *     spawning the real preflight — is in `release-binding-preflight.test.ts`.
 *
 * THE SENTINEL IS SYNTHETIC AND IS NEVER PRINTED. It is a `.test` origin that
 * cannot resolve, it is compared inside the child, and only BOOLEANS cross back
 * into this process. No assertion here can put it into test output.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RELEASE_VALUE_ENV_VARS } from "./explicit-plain-text-bindings";
import {
  RELEASE_VALUE_ENV_KEYS,
  WRANGLER_OUTPUT_DIRECTORY_ENV_KEY,
  WRANGLER_OUTPUT_FILE_ENV_KEY,
  auditReleaseChildEnv,
  buildPreuploadChildEnv,
  buildUploadChildEnv,
} from "./release-child-environment";

/** Synthetic. A reserved `.test` host that cannot resolve. Never printed. */
const SENTINEL_SUPABASE_URL = "https://child-env-sentinel.supabase.test";
/** One of the two documented providers, so the value is realistic in shape. */
const SENTINEL_WRITE_PROVIDER = "r2";
/** Proves ordinary inheritance still works; a stripped-everything env is not the goal. */
const CARRIED_KEY = "FOREVER_CHILD_ENV_CARRIED_MARKER";
const CARRIED_VALUE = "carried-through";

const PARENT_ENV: Record<string, string | undefined> = {
  ...process.env,
  [RELEASE_VALUE_ENV_VARS.SUPABASE_URL]: SENTINEL_SUPABASE_URL,
  [RELEASE_VALUE_ENV_VARS.STUDIO_STORAGE_WRITE_PROVIDER]: SENTINEL_WRITE_PROVIDER,
  [WRANGLER_OUTPUT_DIRECTORY_ENV_KEY]: "C:/not-the-directory-the-wrapper-reads",
  [CARRIED_KEY]: CARRIED_VALUE,
};

/**
 * A child that reports FACTS ABOUT its own environment, never the environment.
 *
 * The sentinel is compared inside the child and only a boolean comes back, so
 * neither a passing run nor a failing diff can carry the value into output.
 */
const PROBE_SOURCE = `
const releaseKeys = ${JSON.stringify(RELEASE_VALUE_ENV_KEYS)};
const sentinel = ${JSON.stringify(SENTINEL_SUPABASE_URL)};
process.stdout.write(
  JSON.stringify({
    releaseKeysPresent: releaseKeys.filter((key) => key in process.env),
    sentinelValueSeen: Object.values(process.env).some((value) => value === sentinel),
    outputDirectoryPresent: ${JSON.stringify(WRANGLER_OUTPUT_DIRECTORY_ENV_KEY)} in process.env,
    outputFile: process.env[${JSON.stringify(WRANGLER_OUTPUT_FILE_ENV_KEY)}] ?? null,
    carriedMarker: process.env[${JSON.stringify(CARRIED_KEY)}] ?? null,
    noColor: process.env.NO_COLOR ?? null,
  }),
);
`;

interface ProbeReport {
  readonly releaseKeysPresent: string[];
  readonly sentinelValueSeen: boolean;
  readonly outputDirectoryPresent: boolean;
  readonly outputFile: string | null;
  readonly carriedMarker: string | null;
  readonly noColor: string | null;
}

let workspace = "";
let probePath = "";

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "forever-child-env-probe-"));
  probePath = join(workspace, "report-own-environment.cjs");
  writeFileSync(probePath, PROBE_SOURCE, "utf8");
});

afterAll(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

/** Spawns the probe with EXACTLY the supplied environment and parses its report. */
function askChild(env: Record<string, string>): ProbeReport {
  const run = spawnSync(process.execPath, [probePath], {
    encoding: "utf8",
    shell: false,
    env,
  });
  expect(run.error, "the probe child could not be started").toBeUndefined();
  expect(run.status, run.stderr ?? "").toBe(0);
  return JSON.parse(run.stdout) as ProbeReport;
}

const OUTPUT_FILE = "C:/forever-release-work/version-upload.ndjson";

describe("PROBE_NOT_VACUOUS: the child really can see a release input", () => {
  it("reports BOTH keys and the sentinel when handed the unsanitized environment", () => {
    // Without this control, every "absent" below would be indistinguishable
    // from a probe that never looked.
    const report = askChild(
      Object.fromEntries(
        Object.entries(PARENT_ENV).filter(([, value]) => typeof value === "string"),
      ) as Record<string, string>,
    );

    expect([...report.releaseKeysPresent].sort()).toEqual([...RELEASE_VALUE_ENV_KEYS].sort());
    expect(report.sentinelValueSeen).toBe(true);
    expect(report.outputDirectoryPresent).toBe(true);
  });
});

describe("PREUPLOAD_CHILD_VALUE_FREE: the preflight process is given no release input", () => {
  const env = () => buildPreuploadChildEnv({ parentEnv: PARENT_ENV });

  it("a REAL child spawned with this environment reports neither key", () => {
    const report = askChild(env());

    expect(report.releaseKeysPresent).toEqual([]);
    // Nor the value under any other name.
    expect(report.sentinelValueSeen).toBe(false);
  });

  it("still inherits everything else it needs, and is not colourised", () => {
    const report = askChild(env());

    expect(report.carriedMarker).toBe(CARRIED_VALUE);
    expect(report.noColor).toBe("1");
  });

  it("the constructed object itself carries neither key", () => {
    const built = env();
    for (const key of RELEASE_VALUE_ENV_KEYS) expect(key in built, key).toBe(false);
    expect(auditReleaseChildEnv(built).ok).toBe(true);
  });
});

describe("WRANGLER_CHILD_VALUE_FREE: the upload process is given no release input", () => {
  const env = () => buildUploadChildEnv({ parentEnv: PARENT_ENV, outputFilePath: OUTPUT_FILE });

  it("a REAL child spawned with this environment reports neither key", () => {
    const report = askChild(env());

    expect(report.releaseKeysPresent).toEqual([]);
    expect(report.sentinelValueSeen).toBe(false);
  });

  it("keeps the exact output FILE and removes the output DIRECTORY override", () => {
    const report = askChild(env());

    expect(report.outputFile).toBe(OUTPUT_FILE);
    expect(report.outputDirectoryPresent).toBe(false);
  });

  it("still inherits the operator environment Wrangler genuinely needs", () => {
    // This is a targeted REMOVAL, not an allowlist: a production upload needs
    // the operator's real Cloudflare credentials and Node environment.
    const report = askChild(env());
    expect(report.carriedMarker).toBe(CARRIED_VALUE);
  });

  it("the constructed object itself carries neither key nor the directory override", () => {
    const built = env();
    for (const key of RELEASE_VALUE_ENV_KEYS) expect(key in built, key).toBe(false);
    expect(WRANGLER_OUTPUT_DIRECTORY_ENV_KEY in built).toBe(false);
    expect(auditReleaseChildEnv(built, { forbidWranglerOutputDirectory: true }).ok).toBe(true);
  });
});

describe("the audit is a real check, and never reprints what it caught", () => {
  it("REPORTS a release input that survived, by KEY only", () => {
    const leaked = {
      [RELEASE_VALUE_ENV_VARS.SUPABASE_URL]: SENTINEL_SUPABASE_URL,
      [RELEASE_VALUE_ENV_VARS.STUDIO_STORAGE_WRITE_PROVIDER]: SENTINEL_WRITE_PROVIDER,
    };
    const verdict = auditReleaseChildEnv(leaked);

    expect(verdict.ok).toBe(false);
    expect(verdict.findings.map((finding) => finding.key).sort()).toEqual(
      [...RELEASE_VALUE_ENV_KEYS].sort(),
    );
    for (const finding of verdict.findings) {
      expect(finding.code).toBe("release_value_env_present");
      expect(finding.detail.includes(SENTINEL_SUPABASE_URL)).toBe(false);
      expect(finding.detail.includes("supabase.test")).toBe(false);
    }
  });

  it("REPORTS the Wrangler output-directory override only where it is forbidden", () => {
    const observed = { [WRANGLER_OUTPUT_DIRECTORY_ENV_KEY]: "C:/somewhere-else" };

    expect(auditReleaseChildEnv(observed).ok).toBe(true);
    const strict = auditReleaseChildEnv(observed, { forbidWranglerOutputDirectory: true });
    expect(strict.ok).toBe(false);
    expect(strict.findings[0]?.code).toBe("wrangler_output_directory_present");
  });

  it("derives the stripped keys from the contract rather than re-listing them", () => {
    expect([...RELEASE_VALUE_ENV_KEYS].sort()).toEqual(
      [...Object.values(RELEASE_VALUE_ENV_VARS)].sort(),
    );
    expect(RELEASE_VALUE_ENV_KEYS).toHaveLength(2);
  });
});
