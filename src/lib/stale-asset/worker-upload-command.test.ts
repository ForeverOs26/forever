/**
 * FOREVER-PR138-MERGE-BLOCKER-CORRECTION-002 — the structured upload command.
 *
 * PR138 independent review, P1-1. The production upload used to be arbitrary
 * operator text validated with `uploadCommand.includes("--keep-vars")`. The
 * review executed fourteen adversarial commands against it: TEN that do not
 * preserve deployment-managed variables were ACCEPTED, including
 * `--keep-vars=false` — the invocation Cloudflare documents as deleting every
 * var, and therefore the exact shape that produced candidate `ae4cae19`.
 *
 * The escape path is gone. The upload is an executable plus an exact argv,
 * compared token-by-token. Every one of those adversarial forms is asserted
 * REFUSED here, by name, so a future edit that reopens the hole fails a test
 * rather than a release.
 *
 * NO SPAWN, NO NETWORK, NO CREDENTIAL. Pure functions over data.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  GENERATED_WORKER_CONFIG_PATH,
  KEEP_VARS_FLAG,
  PRODUCTION_VERSION_UPLOAD_ARGV,
  PRODUCTION_VERSION_UPLOAD_COMMAND,
  PRODUCTION_VERSION_UPLOAD_SPEC,
  SUPPORTED_WRANGLER_VERSION,
  WRANGLER_EXECUTABLE,
  parseWranglerVersionOutput,
  verifyKeepVarsContract,
  verifyUploadSpec,
  verifyWranglerVersion,
} from "./worker-variable-preservation";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** A proposed upload, as data. `args` overrides the canonical vector. */
const spec = (args: readonly string[], executable = WRANGLER_EXECUTABLE) => ({ executable, args });

const codesOf = (result: ReturnType<typeof verifyUploadSpec>) =>
  result.violations.map((violation) => violation.code);

describe("the canonical production upload specification", () => {
  it("is structured data — an executable and an exact argv, never a shell string", () => {
    expect(PRODUCTION_VERSION_UPLOAD_SPEC.executable).toBe(WRANGLER_EXECUTABLE);
    expect([...PRODUCTION_VERSION_UPLOAD_SPEC.args]).toEqual([
      "versions",
      "upload",
      "--keep-vars",
      "--config",
      ".output/server/wrangler.json",
    ]);
  });

  it("is the SINGLE source of truth the human-readable command is derived from", () => {
    // P3-2: the runbook string and the pinned constant were byte-identical and
    // nothing asserted it. The string is now computed from the spec, so they
    // cannot drift apart at all.
    expect(PRODUCTION_VERSION_UPLOAD_COMMAND).toBe(
      [WRANGLER_EXECUTABLE, ...PRODUCTION_VERSION_UPLOAD_ARGV].join(" "),
    );
    expect(PRODUCTION_VERSION_UPLOAD_COMMAND).toBe(
      "wrangler versions upload --keep-vars --config .output/server/wrangler.json",
    );
  });

  it("names the generated artefact, not the reviewed JSONC source", () => {
    expect(GENERATED_WORKER_CONFIG_PATH).toBe(".output/server/wrangler.json");
    expect(PRODUCTION_VERSION_UPLOAD_ARGV).toContain(GENERATED_WORKER_CONFIG_PATH);
  });

  it("ACCEPTS the exact canonical structured argv", () => {
    const verdict = verifyUploadSpec(PRODUCTION_VERSION_UPLOAD_SPEC);
    expect(verdict.violations).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("appears byte-for-byte in the runbook, so documentation cannot drift from it", () => {
    expect(read("docs/FOREVER_PRODUCTION_RELEASE_RUNBOOK.md")).toContain(
      PRODUCTION_VERSION_UPLOAD_COMMAND,
    );
  });
});

/**
 * The adversarial matrix. Each row is a command the substring check accepted or
 * a way the structured form could be weakened; each must be REFUSED, and named.
 */
describe("adversarial upload specifications are REFUSED, token by token", () => {
  it("1. REFUSES --keep-vars=false — Cloudflare's own deleting invocation", () => {
    const verdict = verifyUploadSpec(
      spec(["versions", "upload", "--keep-vars=false", "--config", GENERATED_WORKER_CONFIG_PATH]),
    );
    expect(verdict.ok).toBe(false);
    expect(codesOf(verdict)).toContain("keep_vars_malformed");
    expect(codesOf(verdict)).toContain("keep_vars_missing");
  });

  it("2. REFUSES `--keep-vars false` — one token that needs a shell to split", () => {
    const verdict = verifyUploadSpec(
      spec(["versions", "upload", "--keep-vars false", "--config", GENERATED_WORKER_CONFIG_PATH]),
    );
    expect(verdict.ok).toBe(false);
    expect(codesOf(verdict)).toContain("shell_metacharacter");
    expect(codesOf(verdict)).toContain("keep_vars_missing");
  });

  it("2b. REFUSES `--keep-vars` followed by a `false` positional", () => {
    const verdict = verifyUploadSpec(
      spec([
        "versions",
        "upload",
        "--keep-vars",
        "false",
        "--config",
        GENERATED_WORKER_CONFIG_PATH,
      ]),
    );
    expect(verdict.ok).toBe(false);
    expect(codesOf(verdict)).toContain("extra_argument");
    expect(codesOf(verdict)).toContain("argv_not_canonical");
  });

  it("3. REFUSES --keep-vars-disabled", () => {
    const verdict = verifyUploadSpec(
      spec([
        "versions",
        "upload",
        "--keep-vars-disabled",
        "--config",
        GENERATED_WORKER_CONFIG_PATH,
      ]),
    );
    expect(verdict.ok).toBe(false);
    expect(codesOf(verdict)).toContain("keep_vars_malformed");
  });

  it("4. REFUSES --no-keep-vars", () => {
    const verdict = verifyUploadSpec(
      spec(["versions", "upload", "--no-keep-vars", "--config", GENERATED_WORKER_CONFIG_PATH]),
    );
    expect(verdict.ok).toBe(false);
    expect(codesOf(verdict)).toContain("keep_vars_malformed");
  });

  it("5. REFUSES a comment-only occurrence of the flag", () => {
    const verdict = verifyUploadSpec(
      spec(["versions", "upload", "--config", GENERATED_WORKER_CONFIG_PATH, "#", "--keep-vars"]),
    );
    expect(verdict.ok).toBe(false);
    expect(codesOf(verdict)).toContain("shell_metacharacter");
    expect(codesOf(verdict)).toContain("argv_not_canonical");
  });

  it("6. REFUSES the substring hiding inside an unrelated argument", () => {
    const verdict = verifyUploadSpec(
      spec([
        "versions",
        "upload",
        "--message",
        "release-with-keep-vars",
        "--config",
        GENERATED_WORKER_CONFIG_PATH,
      ]),
    );
    expect(verdict.ok).toBe(false);
    expect(codesOf(verdict)).toContain("keep_vars_malformed");
    expect(codesOf(verdict)).toContain("keep_vars_missing");
  });

  it("7. REFUSES the flag after a `--` terminator, where it is an operand", () => {
    const verdict = verifyUploadSpec(
      spec(["versions", "upload", "--config", GENERATED_WORKER_CONFIG_PATH, "--", "--keep-vars"]),
    );
    expect(verdict.ok).toBe(false);
    expect(codesOf(verdict)).toContain("argument_terminator_present");
  });

  it("8. REFUSES `echo '--keep-vars'` — a different program entirely", () => {
    const verdict = verifyUploadSpec(spec(["'--keep-vars'"], "echo"));
    expect(verdict.ok).toBe(false);
    expect(codesOf(verdict)).toContain("wrong_executable");
    expect(codesOf(verdict)).toContain("shell_metacharacter");
  });

  it("9. REFUSES `wrangler deploy` — deploy moves traffic, it is not the upload", () => {
    const verdict = verifyUploadSpec(
      spec(["deploy", "--keep-vars", "--config", GENERATED_WORKER_CONFIG_PATH]),
    );
    expect(verdict.ok).toBe(false);
    expect(codesOf(verdict)).toContain("wrong_subcommand");
  });

  it("10. REFUSES the wrong generated config path", () => {
    const verdict = verifyUploadSpec(
      spec(["versions", "upload", "--keep-vars", "--config", "wrangler.jsonc"]),
    );
    expect(verdict.ok).toBe(false);
    expect(codesOf(verdict)).toContain("wrong_config_path");
  });

  it("11. REFUSES an upload with no --config at all", () => {
    const verdict = verifyUploadSpec(spec(["versions", "upload", "--keep-vars"]));
    expect(verdict.ok).toBe(false);
    expect(codesOf(verdict)).toContain("config_missing");
  });

  it("12. REFUSES a duplicated --keep-vars", () => {
    const verdict = verifyUploadSpec(
      spec([
        "versions",
        "upload",
        "--keep-vars",
        "--keep-vars",
        "--config",
        GENERATED_WORKER_CONFIG_PATH,
      ]),
    );
    expect(verdict.ok).toBe(false);
    expect(codesOf(verdict)).toContain("keep_vars_duplicated");
  });

  it("13. REFUSES a duplicated --config", () => {
    const verdict = verifyUploadSpec(
      spec([
        "versions",
        "upload",
        "--keep-vars",
        "--config",
        GENERATED_WORKER_CONFIG_PATH,
        "--config",
        GENERATED_WORKER_CONFIG_PATH,
      ]),
    );
    expect(verdict.ok).toBe(false);
    expect(codesOf(verdict)).toContain("config_duplicated");
  });

  it("14. REFUSES shell metacharacters in any token", () => {
    for (const token of [
      "&& rm -rf .",
      "; wrangler deploy",
      "$(printf keep-vars)",
      "`id`",
      "--config|tee",
      ">out.txt",
    ]) {
      const verdict = verifyUploadSpec(
        spec([
          "versions",
          "upload",
          "--keep-vars",
          "--config",
          GENERATED_WORKER_CONFIG_PATH,
          token,
        ]),
      );
      expect(verdict.ok, token).toBe(false);
      expect(codesOf(verdict), token).toContain("shell_metacharacter");
    }
  });

  it("14b. REFUSES a control character smuggled into a token", () => {
    for (const token of ["a b", "ab", "ab"]) {
      const verdict = verifyUploadSpec(
        spec([
          "versions",
          "upload",
          "--keep-vars",
          "--config",
          GENERATED_WORKER_CONFIG_PATH,
          token,
        ]),
      );
      expect(verdict.ok, JSON.stringify(token)).toBe(false);
      expect(codesOf(verdict), JSON.stringify(token)).toContain("shell_metacharacter");
    }
  });

  it("15. REFUSES an arbitrary executable", () => {
    for (const executable of ["node", "npx", "sh", "bash", "cmd", "powershell", "wrangler.cmd"]) {
      const verdict = verifyUploadSpec(spec(PRODUCTION_VERSION_UPLOAD_ARGV, executable));
      expect(verdict.ok, executable).toBe(false);
      expect(codesOf(verdict), executable).toContain("wrong_executable");
    }
  });

  it("15b. ACCEPTS a resolved repository-local wrangler entry point", () => {
    for (const executable of [
      "node_modules/wrangler/bin/wrangler.js",
      "C:/repo/node_modules/wrangler/bin/wrangler.js",
      "/repo/node_modules/wrangler/bin/wrangler.mjs",
    ]) {
      const verdict = verifyUploadSpec(spec(PRODUCTION_VERSION_UPLOAD_ARGV, executable));
      expect(verdict.violations, executable).toEqual([]);
    }
  });

  it("16. REFUSES an extra positional argument", () => {
    const verdict = verifyUploadSpec(
      spec([
        "versions",
        "upload",
        "--keep-vars",
        "--config",
        GENERATED_WORKER_CONFIG_PATH,
        "./src/worker.ts",
      ]),
    );
    expect(verdict.ok).toBe(false);
    expect(codesOf(verdict)).toContain("extra_argument");
    expect(codesOf(verdict)).toContain("argv_not_canonical");
  });

  it("17. REFUSES an empty argv", () => {
    const verdict = verifyUploadSpec(spec([]));
    expect(verdict.ok).toBe(false);
    expect(codesOf(verdict)).toContain("empty_argv");
  });

  it("REFUSES a shell command STRING outright — the removed escape path", () => {
    for (const command of [
      "wrangler versions upload --keep-vars --config .output/server/wrangler.json",
      "wrangler versions upload --keep-vars=false --config .output/server/wrangler.json",
      "",
    ]) {
      const verdict = verifyUploadSpec(command);
      expect(verdict.ok, command).toBe(false);
      expect(codesOf(verdict), command).toContain("spec_malformed");
    }
  });

  it("REFUSES a malformed or padded specification object", () => {
    expect(verifyUploadSpec(null).ok).toBe(false);
    expect(verifyUploadSpec([]).ok).toBe(false);
    expect(verifyUploadSpec({ executable: WRANGLER_EXECUTABLE }).ok).toBe(false);
    const padded = verifyUploadSpec({
      executable: WRANGLER_EXECUTABLE,
      args: [...PRODUCTION_VERSION_UPLOAD_ARGV],
      shell: true,
    });
    expect(padded.ok).toBe(false);
    expect(codesOf(padded)).toContain("spec_malformed");
  });

  it("never echoes a rejected token back into its own refusal", () => {
    const smuggled = "CANARY_TOKEN_IN_ARGV_9F3K";
    const verdict = verifyUploadSpec(
      spec([
        "versions",
        "upload",
        "--keep-vars",
        "--config",
        GENERATED_WORKER_CONFIG_PATH,
        smuggled,
      ]),
    );
    expect(verdict.ok).toBe(false);
    expect(JSON.stringify(verdict.violations)).not.toContain(smuggled);
  });
});

describe("verifyKeepVarsContract consumes the structured specification", () => {
  it("accepts keep_vars=true plus the canonical spec", () => {
    const verdict = verifyKeepVarsContract({
      generatedConfig: { keep_vars: true },
      uploadSpec: PRODUCTION_VERSION_UPLOAD_SPEC,
    });
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("REFUSES a shell string where a specification belongs", () => {
    const verdict = verifyKeepVarsContract({
      generatedConfig: { keep_vars: true },
      uploadSpec: "wrangler versions upload --keep-vars --config .output/server/wrangler.json",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.specViolations.map((violation) => violation.code)).toContain("spec_malformed");
  });

  it("REFUSES --keep-vars=false even though the substring is present", () => {
    const verdict = verifyKeepVarsContract({
      generatedConfig: { keep_vars: true },
      uploadSpec: spec([
        "versions",
        "upload",
        "--keep-vars=false",
        "--config",
        GENERATED_WORKER_CONFIG_PATH,
      ]),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("keep_vars_malformed");
  });

  it("still REFUSES a config missing keep_vars, and a vars block", () => {
    expect(
      verifyKeepVarsContract({ generatedConfig: {}, uploadSpec: PRODUCTION_VERSION_UPLOAD_SPEC })
        .ok,
    ).toBe(false);
    const withVars = verifyKeepVarsContract({
      generatedConfig: { keep_vars: true, vars: {} },
      uploadSpec: PRODUCTION_VERSION_UPLOAD_SPEC,
    });
    expect(withVars.ok).toBe(false);
    expect(withVars.reasons.join(" ")).toContain("declares a vars block");
  });
});

describe("the Wrangler version gate is exact", () => {
  it("pins one supported version", () => {
    expect(SUPPORTED_WRANGLER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("parses the version Wrangler actually prints", () => {
    expect(parseWranglerVersionOutput(`${SUPPORTED_WRANGLER_VERSION}\n`)).toBe(
      SUPPORTED_WRANGLER_VERSION,
    );
    expect(parseWranglerVersionOutput(` ⛅️ wrangler ${SUPPORTED_WRANGLER_VERSION} \n`)).toBe(
      SUPPORTED_WRANGLER_VERSION,
    );
    expect(parseWranglerVersionOutput("no version here")).toBeNull();
  });

  it("ACCEPTS only the supported version — never a newer or older one", () => {
    expect(verifyWranglerVersion(SUPPORTED_WRANGLER_VERSION).ok).toBe(true);
    for (const other of ["4.117.0", "4.119.0", "3.0.0", "4.118.1", ""]) {
      expect(verifyWranglerVersion(other).ok, other).toBe(false);
    }
    expect(verifyWranglerVersion(null).ok).toBe(false);
  });

  it("says why an unidentified Wrangler is refused rather than assumed", () => {
    expect(verifyWranglerVersion(null).reasons.join(" ")).toContain("never used");
  });
});

describe("no shell is involved anywhere in the release upload path", () => {
  const RELEASE_SCRIPTS = [
    "scripts/release/upload-worker-version.mjs",
    "scripts/release/wrangler-version-gate.mjs",
    "scripts/release/verify-binding-preservation.mjs",
    "scripts/release/capture-worker-version-bindings.mjs",
  ];

  it("never passes shell: true, and every spawn states shell: false", () => {
    for (const script of RELEASE_SCRIPTS) {
      const source = read(script);
      expect(source, script).not.toMatch(/shell:\s*true/);
      expect(source, script).not.toMatch(/shell:\s*process\.platform/);
    }
    for (const script of [
      "scripts/release/upload-worker-version.mjs",
      "scripts/release/wrangler-version-gate.mjs",
    ]) {
      expect(read(script), script).toContain("shell: false");
    }
  });

  it("never concatenates a wrangler command out of text", () => {
    for (const script of RELEASE_SCRIPTS) {
      const source = read(script);
      expect(source, script).not.toMatch(/["'`]wrangler\s[^"'`]*["'`]\s*\+/);
      expect(source, script).not.toMatch(/exec\(|execSync\(/);
    }
  });

  it("spawns wrangler from the canonical argv only, in the one wrapper", () => {
    const wrapper = read("scripts/release/upload-worker-version.mjs");
    expect(wrapper).toContain("...PRODUCTION_VERSION_UPLOAD_SPEC.args");
    expect(wrapper).toContain("--authorize-upload");
    // The wrapper refuses to spawn until the preflight has produced PASS.
    expect(wrapper).toContain("PREUPLOAD_CONTRACT_OK");
    expect(wrapper).toContain("the binding preflight did not produce PASS");
  });
});
