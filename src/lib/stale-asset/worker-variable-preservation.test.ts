/**
 * FOREVER-WRANGLER-KEEP-VARS-CORRECTION-001 — the keep-vars contract.
 *
 * Candidate `ae4cae19` uploaded from exact merged main with 10 bindings where
 * the live Worker had 12, lost SUPABASE_URL and STUDIO_STORAGE_WRITE_PROVIDER,
 * and returned HTTP 500 on its preview. It was caught at 0% and no traffic
 * moved. These assertions are what makes that unrepeatable.
 *
 * FAIL-CLOSED, NEVER SKIPPED. The generated-configuration checks require a
 * production build; a missing build is a FAILURE with an actionable message,
 * never a skip. That distinction is the reason the earlier gap stayed invisible
 * long enough to reach an upload.
 *
 * NO VALUES ANYWHERE. This file names bindings. It contains no variable value,
 * no secret, no token and no production URL, and it asserts that the repository
 * contains none either.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS,
  DEPLOYMENT_MANAGED_SECRET_BINDINGS,
  EXPECTED_PRODUCTION_BINDING_COUNT,
  KEEP_VARS_CONFIG_KEY,
  KEEP_VARS_FLAG,
  PRODUCTION_VERSION_UPLOAD_COMMAND,
  REPOSITORY_DECLARED_BINDINGS,
  type BindingDescriptor,
  bindingFingerprint,
  expectedProductionBindings,
  verifyBindingPreservation,
  verifyKeepVarsContract,
} from "./worker-variable-preservation";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function parseJsonc(source: string): Record<string, unknown> {
  const withoutComments = source.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutTrailingCommas = withoutComments.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(withoutTrailingCommas) as Record<string, unknown>;
}

const GENERATED = ".output/server/wrangler.json";
const MISSING_BUILD =
  "no production build to inspect. Run `npm run build` before this suite — a missing build " +
  "artifact is a FAILURE, never a skip.";

function requireGeneratedConfig(): Record<string, unknown> {
  if (!existsSync(resolve(process.cwd(), GENERATED))) throw new Error(MISSING_BUILD);
  return JSON.parse(read(GENERATED)) as Record<string, unknown>;
}

const wranglerSource = read("wrangler.jsonc");
const sourceConfig = parseJsonc(wranglerSource);
const runbook = read("docs/FOREVER_PRODUCTION_RELEASE_RUNBOOK.md");
const flat = (text: string) => text.replace(/\s+/g, " ");

/** The live binding set, by NAME and CLASS only. No value is present. */
const LIVE_BINDINGS: BindingDescriptor[] = expectedProductionBindings();

describe("canonical Wrangler configuration preserves deployment-managed vars", () => {
  it("sets keep_vars: true in the reviewed source", () => {
    expect(sourceConfig[KEEP_VARS_CONFIG_KEY]).toBe(true);
  });

  it("retains keep_vars=true in the generated Worker config that actually deploys", () => {
    expect(requireGeneratedConfig()[KEEP_VARS_CONFIG_KEY]).toBe(true);
  });

  it("still declares NO vars block — omitting vars and keeping vars are BOTH required", () => {
    // Omitting `vars` stops the repository OVERWRITING deployment-managed
    // values. `keep_vars` stops Wrangler DELETING them first. One without the
    // other is how candidate ae4cae19 lost two bindings.
    expect(sourceConfig.vars).toBeUndefined();
    expect(requireGeneratedConfig().vars).toBeUndefined();
    expect(wranglerSource).not.toContain('"vars"');
  });

  it("explains why the flag is required, so a later edit cannot read it as noise", () => {
    expect(wranglerSource).toContain("keep_vars");
    expect(flat(wranglerSource)).toContain("delete all vars");
    expect(flat(wranglerSource)).toContain("secrets are never deleted");
  });
});

describe("the production upload command carries the flag explicitly", () => {
  it("pins the exact command, including --keep-vars", () => {
    expect(PRODUCTION_VERSION_UPLOAD_COMMAND).toContain("wrangler versions upload");
    expect(PRODUCTION_VERSION_UPLOAD_COMMAND).toContain(KEEP_VARS_FLAG);
  });

  it("requires the runbook's candidate upload step to pass --keep-vars", () => {
    expect(flat(runbook)).toContain("wrangler versions upload --keep-vars");
  });

  it("never documents a bare `wrangler versions upload` as the production step", () => {
    // The instruction that produced the incident was a bare upload. Every
    // occurrence that is an INSTRUCTION must now carry the flag. The §1a
    // identity table names the command as the SOURCE of the Worker version
    // UUID rather than telling anyone to run it, so table rows are prose.
    const instructionLines = runbook
      .split("\n")
      .filter((line) => line.includes("wrangler versions upload"))
      .filter((line) => !line.trim().startsWith("|"));
    expect(instructionLines.length).toBeGreaterThan(0);
    for (const line of instructionLines) {
      expect(line, `instruction without ${KEEP_VARS_FLAG}: ${line}`).toContain(KEEP_VARS_FLAG);
    }
  });
});

describe("verifyKeepVarsContract — defence in depth, reported independently", () => {
  it("accepts a config with keep_vars=true and a command with --keep-vars", () => {
    const verdict = verifyKeepVarsContract({
      generatedConfig: { keep_vars: true },
      uploadCommand: PRODUCTION_VERSION_UPLOAD_COMMAND,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });

  it("REFUSES a config missing keep_vars even when the command carries the flag", () => {
    const verdict = verifyKeepVarsContract({
      generatedConfig: {},
      uploadCommand: PRODUCTION_VERSION_UPLOAD_COMMAND,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("does not set keep_vars: true");
  });

  it("REFUSES a bare upload command even when the config carries keep_vars", () => {
    const verdict = verifyKeepVarsContract({
      generatedConfig: { keep_vars: true },
      uploadCommand: "wrangler versions upload --config .output/server/wrangler.json",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("does not pass --keep-vars");
  });

  it("REFUSES a vars block, which replaces the values keep_vars preserves", () => {
    const verdict = verifyKeepVarsContract({
      generatedConfig: { keep_vars: true, vars: {} },
      uploadCommand: PRODUCTION_VERSION_UPLOAD_COMMAND,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("declares a vars block");
  });
});

describe("binding contract distinguishes NAMES from secret VALUES", () => {
  it("expects exactly twelve bindings, in three classes", () => {
    expect(REPOSITORY_DECLARED_BINDINGS).toHaveLength(4);
    expect(DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS).toHaveLength(2);
    expect(DEPLOYMENT_MANAGED_SECRET_BINDINGS).toHaveLength(6);
    expect(EXPECTED_PRODUCTION_BINDING_COUNT).toBe(12);
    expect(expectedProductionBindings()).toHaveLength(12);
  });

  it("names the two plain-text variables the failed candidate lost", () => {
    expect([...DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS].sort()).toEqual([
      "STUDIO_STORAGE_WRITE_PROVIDER",
      "SUPABASE_URL",
    ]);
  });

  it("enumerates secrets by NAME only — no value, no shape, no prefix", () => {
    const contractSource = read("src/lib/stale-asset/worker-variable-preservation.ts");
    for (const marker of ["sb_secret_", "sb_publishable_", "eyJ", "-----BEGIN"]) {
      expect(contractSource, marker).not.toContain(marker);
    }
  });

  it("computes a fingerprint from names and classes, never values", () => {
    const fingerprint = bindingFingerprint(LIVE_BINDINGS);
    expect(fingerprint).toContain("SUPABASE_URL:plain_text");
    expect(fingerprint).toContain("STUDIO_STORAGE_WRITE_PROVIDER:plain_text");
    expect(fingerprint).toContain("SUPABASE_SERVICE_ROLE_KEY:secret_text");
    expect(fingerprint).toContain("ASSETS:assets");
    // A fingerprint is order-independent.
    expect(bindingFingerprint([...LIVE_BINDINGS].reverse())).toBe(fingerprint);
  });
});

describe("verifyBindingPreservation — fail-closed", () => {
  const candidateMissing = (...names: string[]) =>
    LIVE_BINDINGS.filter((binding) => !names.includes(binding.name));

  it("accepts a candidate whose binding set equals the live Worker's", () => {
    const verdict = verifyBindingPreservation(LIVE_BINDINGS, LIVE_BINDINGS);
    expect(verdict.ok).toBe(true);
    expect(verdict.violations).toEqual([]);
    expect(verdict.candidateFingerprint).toBe(verdict.liveFingerprint);
  });

  it("REPRODUCES the ae4cae19 failure: both plain-text vars missing is a STOP", () => {
    const verdict = verifyBindingPreservation(
      LIVE_BINDINGS,
      candidateMissing("SUPABASE_URL", "STUDIO_STORAGE_WRITE_PROVIDER"),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.candidateBindingCount).toBe(10);
    expect(verdict.liveBindingCount).toBe(12);
    const codes = verdict.violations.map((violation) => violation.code);
    expect(codes).toContain("plain_text_binding_missing");
    expect(codes).toContain("provider_binding_missing");
    expect(codes).toContain("binding_count_regressed");
  });

  it("STOPS when only ONE of the two plain-text bindings is present", () => {
    const verdict = verifyBindingPreservation(LIVE_BINDINGS, candidateMissing("SUPABASE_URL"));
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((violation) => violation.binding)).toContain("SUPABASE_URL");
  });

  it("STOPS when the provider binding is missing", () => {
    const verdict = verifyBindingPreservation(
      LIVE_BINDINGS,
      candidateMissing("STUDIO_STORAGE_WRITE_PROVIDER"),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((violation) => violation.code)).toContain(
      "provider_binding_missing",
    );
  });

  it("STOPS when a secret binding name disappears", () => {
    const verdict = verifyBindingPreservation(
      LIVE_BINDINGS,
      candidateMissing("SUPABASE_SERVICE_ROLE_KEY"),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((violation) => violation.code)).toContain(
      "secret_binding_missing",
    );
  });

  it("STOPS when an R2 binding or ASSETS is missing", () => {
    expect(verifyBindingPreservation(LIVE_BINDINGS, candidateMissing("R2_PUBLIC_MEDIA")).ok).toBe(
      false,
    );
    const assets = verifyBindingPreservation(LIVE_BINDINGS, candidateMissing("ASSETS"));
    expect(assets.ok).toBe(false);
    expect(assets.violations.map((violation) => violation.code)).toContain(
      "assets_binding_missing",
    );
  });

  it("STOPS on the removal of a binding this contract never enumerated", () => {
    const live = [...LIVE_BINDINGS, { name: "FUTURE_BINDING", type: "plain_text" } as const];
    const verdict = verifyBindingPreservation(live, LIVE_BINDINGS);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((violation) => violation.code)).toContain("binding_removed");
  });

  it("STOPS when a binding changes class", () => {
    const candidate = LIVE_BINDINGS.map((binding) =>
      binding.name === "SUPABASE_URL" ? { ...binding, type: "secret_text" as const } : binding,
    );
    const verdict = verifyBindingPreservation(LIVE_BINDINGS, candidate);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((violation) => violation.code)).toContain("wrong_binding_class");
  });

  it("STOPS on a forbidden binding reappearing", () => {
    const candidate = [
      ...LIVE_BINDINGS,
      { name: "STUDIO_OWNER_EMAIL", type: "secret_text" } as const,
    ];
    const verdict = verifyBindingPreservation(LIVE_BINDINGS, candidate);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((violation) => violation.code)).toContain(
      "forbidden_binding_present",
    );
  });

  it("REFUSES to treat surviving secrets as proof that plain-text vars survived", () => {
    // The exact false-negative that made the incident possible: every secret
    // present, every plain-text variable gone. Cloudflare never deletes
    // secrets, so this candidate's secrets could not have failed.
    const secretsOnlyCandidate = LIVE_BINDINGS.filter((binding) => binding.type !== "plain_text");
    const allSecretsPresent = DEPLOYMENT_MANAGED_SECRET_BINDINGS.every((name) =>
      secretsOnlyCandidate.some((binding) => binding.name === name),
    );
    expect(allSecretsPresent).toBe(true);

    const verdict = verifyBindingPreservation(LIVE_BINDINGS, secretsOnlyCandidate);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((violation) => violation.code)).toContain(
      "plain_text_binding_missing",
    );
  });

  it("REJECTS a candidate with fewer bindings than live even though it holds 0% traffic", () => {
    const verdict = verifyBindingPreservation(LIVE_BINDINGS, candidateMissing("SUPABASE_URL"));
    expect(verdict.ok).toBe(false);
    const detail = verdict.violations.map((violation) => violation.detail).join(" ");
    expect(detail).toContain("0%");
  });
});

describe("server-only boundary for the deployment-managed variables", () => {
  it("keeps SUPABASE_URL and the provider out of any client-exposed variable name", () => {
    // A `VITE_`-prefixed or `import.meta.env.VITE_` reference would ship the
    // value to the browser. Neither variable may ever acquire one.
    for (const name of DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS) {
      expect(`VITE_${name}`.startsWith("VITE_")).toBe(true);
      const clientForm = new RegExp(`VITE_${name}\\b`);
      expect(clientForm.test(read("src/lib/stale-asset/worker-variable-preservation.ts"))).toBe(
        false,
      );
    }
  });

  it("commits no value for either deployment-managed variable", () => {
    // The repository may NAME them. It must never carry what they hold.
    const contractSource = read("src/lib/stale-asset/worker-variable-preservation.ts");
    for (const source of [contractSource, wranglerSource]) {
      expect(source).not.toMatch(/https:\/\/[a-z0-9]{20}\.supabase\.co/);
      expect(source).not.toMatch(/STUDIO_STORAGE_WRITE_PROVIDER\s*[:=]\s*["']r2["']/);
    }
  });

  it("declares no value for either variable anywhere in the generated deploy config", () => {
    const generated = JSON.stringify(requireGeneratedConfig());
    expect(generated).not.toMatch(/https:\/\/[a-z0-9]{20}\.supabase\.co/);
    for (const name of DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS) {
      // The generated config must not declare them at all — that is what
      // keeps the deployment plane the source of truth.
      expect(generated, name).not.toContain(`"${name}"`);
    }
  });
});
