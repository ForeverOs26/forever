/**
 * FOREVER-WRANGLER-KEEP-VARS-CORRECTION-001 — the preflight, executed.
 *
 * The contract module is unit-tested next door. This file runs the actual
 * script the release procedure invokes, because a fail-closed guard that is
 * only asserted in theory has not been shown to fail closed.
 *
 * It proves, by exit code:
 *
 *   - a preserved candidate PASSES;
 *   - the rejected candidate's shape STOPS, and says why;
 *   - a capture carrying anything beyond name and class is REFUSED unread;
 *   - a missing or empty input is a STOP, never a silent pass.
 *
 * NO PRODUCTION CONTACT. Every input is a committed sanitized fixture. The
 * script performs no network call and this suite gives it no credential.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SCRIPT = "scripts/release/verify-binding-preservation.mjs";
const FIXTURES = "scripts/release/fixtures";
const LIVE = `${FIXTURES}/live-bindings.json`;

function runPreflight(...args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
}

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("release binding preflight — fail-closed, executed", () => {
  it("PASSES a candidate that preserved every binding", () => {
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-preserved-bindings.json`,
    );
    expect(`${result.stdout}${result.stderr}`).toContain("PASS");
    expect(result.status).toBe(0);
  });

  it("STOPS on the rejected candidate's shape and names both lost variables", () => {
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-rejected-bindings.json`,
    );
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).toBe(1);
    expect(output).toContain("SUPABASE_URL");
    expect(output).toContain("STUDIO_STORAGE_WRITE_PROVIDER");
    expect(output).toContain("plain_text_binding_missing");
    expect(output).toContain("provider_binding_missing");
    expect(output).toContain("binding_count_regressed");
  });

  it("says explicitly that 0% traffic does not make a short candidate acceptable", () => {
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-rejected-bindings.json`,
    );
    expect(`${result.stdout}${result.stderr}`).toContain("0% of traffic");
  });

  it("warns that surviving secrets prove nothing about plain-text variables", () => {
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-rejected-bindings.json`,
    );
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain("Cloudflare never deletes secrets");
  });

  it("REFUSES a capture that recorded more than name and class", () => {
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-valued-bindings.json`,
    );
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("NAME and CLASS only");
  });

  it("STOPS when an input is missing entirely — absence is never a pass", () => {
    const result = runPreflight("--live", LIVE, "--candidate", `${FIXTURES}/does-not-exist.json`);
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("STOP");
  });

  it("STOPS when no candidate argument is supplied at all", () => {
    const result = runPreflight("--live", LIVE);
    expect(result.status).toBe(1);
  });
});

describe("preflight fixtures carry no production value", () => {
  const fixtureFiles = [
    "live-bindings.json",
    "candidate-preserved-bindings.json",
    "candidate-rejected-bindings.json",
    "candidate-valued-bindings.json",
  ];

  it("records binding names and classes only — never a value", () => {
    for (const file of fixtureFiles) {
      const source = read(`${FIXTURES}/${file}`);
      expect(source, file).not.toMatch(/https:\/\/[a-z0-9]{20}\.supabase\.co/);
      expect(source, file).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/,
      );
      for (const marker of ["sb_secret_", "sb_publishable_", "eyJ", "@", "Bearer "]) {
        expect(source, `${file} :: ${marker}`).not.toContain(marker);
      }
    }
  });

  it("the live fixture is the full twelve-binding production shape", () => {
    const live = JSON.parse(read(LIVE)) as { bindings: Array<{ name: string; type: string }> };
    expect(live.bindings).toHaveLength(12);
    expect(live.bindings.filter((binding) => binding.type === "plain_text")).toHaveLength(2);
    expect(live.bindings.filter((binding) => binding.type === "secret_text")).toHaveLength(6);
  });

  it("the rejected fixture is the ten-binding shape that was caught at 0%", () => {
    const rejected = JSON.parse(read(`${FIXTURES}/candidate-rejected-bindings.json`)) as {
      bindings: Array<{ name: string; type: string }>;
    };
    expect(rejected.bindings).toHaveLength(10);
    expect(rejected.bindings.filter((binding) => binding.type === "plain_text")).toHaveLength(0);
    expect(rejected.bindings.filter((binding) => binding.type === "secret_text")).toHaveLength(6);
  });
});
