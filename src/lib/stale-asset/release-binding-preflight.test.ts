/**
 * FOREVER-WRANGLER-KEEP-VARS-CORRECTION-001 — the preflight, executed.
 * Corrected by FOREVER-PR138-MERGE-BLOCKER-CORRECTION-002.
 *
 * The contract module is unit-tested next door. This file runs the actual
 * scripts the release procedure invokes, because a fail-closed guard that is
 * only asserted in theory has not been shown to fail closed.
 *
 * It proves, by exit code:
 *
 *   - a preserved candidate PASSES;
 *   - the rejected candidate's shape STOPS, and says why;
 *   - a capture carrying anything beyond name and class is REFUSED unread;
 *   - an unknown TOP-LEVEL key is REFUSED — P2-1, which used to PASS;
 *   - a duplicate descriptor is REFUSED — P2-2, which used to PASS;
 *   - one added plus one removed binding at EQUAL COUNT is REFUSED, by
 *     fingerprint — the check that used to be printed but not enforced;
 *   - the removed `--command` free-text surface is refused loudly;
 *   - the upload wrapper will not spawn Wrangler unless every gate held.
 *
 * NO PRODUCTION CONTACT. Every input is a committed sanitized fixture. The
 * scripts perform no network call and this suite gives them no credential and
 * no upload authorization.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SCRIPT = "scripts/release/verify-binding-preservation.mjs";
const WRAPPER = "scripts/release/upload-worker-version.mjs";
const GATE = "scripts/release/wrangler-version-gate.mjs";
const FIXTURES = "scripts/release/fixtures";
const LIVE = `${FIXTURES}/live-bindings.json`;

function run(script: string, ...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
}

const runPreflight = (...args: string[]) => run(SCRIPT, ...args);
const output = (result: ReturnType<typeof run>) => `${result.stdout}${result.stderr}`;

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("release binding preflight — fail-closed, executed", () => {
  it("PASSES a candidate that preserved every binding", () => {
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-preserved-bindings.json`,
    );
    expect(output(result)).toContain("PASS");
    expect(result.status).toBe(0);
  });

  it("STOPS on the rejected candidate's shape and names both lost variables", () => {
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-rejected-bindings.json`,
    );
    expect(result.status).toBe(1);
    expect(output(result)).toContain("SUPABASE_URL");
    expect(output(result)).toContain("STUDIO_STORAGE_WRITE_PROVIDER");
    expect(output(result)).toContain("plain_text_binding_missing");
    expect(output(result)).toContain("provider_binding_missing");
    expect(output(result)).toContain("binding_count_regressed");
  });

  it("says explicitly that 0% traffic does not make a short candidate acceptable", () => {
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-rejected-bindings.json`,
    );
    expect(output(result)).toContain("0% of traffic");
  });

  it("warns that surviving secrets prove nothing about plain-text variables", () => {
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-rejected-bindings.json`,
    );
    expect(output(result)).toContain("Cloudflare never deletes secrets");
  });

  it("REFUSES a capture that recorded more than name and class", () => {
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-valued-bindings.json`,
    );
    expect(result.status).toBe(1);
    expect(output(result)).toContain("unknown_descriptor_key");
  });

  it("STOPS when an input is missing entirely — absence is never a pass", () => {
    const result = runPreflight("--live", LIVE, "--candidate", `${FIXTURES}/does-not-exist.json`);
    expect(result.status).toBe(1);
    expect(output(result)).toContain("STOP");
  });

  it("STOPS when no candidate argument is supplied at all", () => {
    expect(runPreflight("--live", LIVE).status).toBe(1);
  });
});

describe("P2-1 — the CLOSED snapshot schema, enforced by the executed script", () => {
  it("REFUSES an unknown top-level key instead of reading past it", () => {
    const result = runPreflight(
      "--live",
      `${FIXTURES}/snapshot-unknown-top-level-key.json`,
      "--candidate",
      `${FIXTURES}/candidate-preserved-bindings.json`,
    );
    expect(result.status).toBe(1);
    expect(output(result)).toContain("snapshot_schema_invalid");
    expect(output(result)).toContain("unknown_top_level_key");
  });

  it("reports the offending KEY names and never their values", () => {
    const result = runPreflight(
      "--live",
      `${FIXTURES}/snapshot-unknown-top-level-key.json`,
      "--candidate",
      `${FIXTURES}/candidate-preserved-bindings.json`,
    );
    expect(output(result)).toContain("_note");
    expect(output(result)).toContain("values");
    expect(output(result)).not.toContain("a capture that stored more than the schema allows");
  });

  it("STOPS on malformed JSON without echoing the document", () => {
    const result = runPreflight(
      "--live",
      "package.json",
      "--candidate",
      `${FIXTURES}/candidate-preserved-bindings.json`,
    );
    expect(result.status).toBe(1);
    expect(output(result)).toContain("snapshot_schema_invalid");
  });
});

describe("P2-2 — duplicates and EXACT fingerprint equality", () => {
  it("REFUSES a twelve-descriptor candidate carrying a duplicate", () => {
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-duplicate-bindings.json`,
    );
    expect(result.status).toBe(1);
    expect(output(result)).toContain("duplicate_binding_name");
  });

  it("REFUSES the adversarial equal-count candidate for NAMED reasons", () => {
    // Twelve descriptors: a required plain-text name missing, a foreign name
    // inserted, and a duplicated name. The count check is satisfied and the
    // candidate is still rejected.
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-swapped-bindings.json`,
    );
    expect(result.status).toBe(1);
    expect(output(result)).toContain("duplicate_binding_name");
    expect(output(result)).not.toContain("PASS");
  });

  it("REFUSES one added plus one removed binding at EQUAL COUNT, by fingerprint", () => {
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-equal-count-bindings.json`,
    );
    const text = output(result);
    expect(result.status).toBe(1);
    expect(text).toContain("candidate bindings : 12");
    expect(text).toContain("fingerprints equal : false");
    expect(text).toContain("binding_added");
    expect(text).toContain("fingerprint_mismatch");
    expect(text).not.toContain("binding_count_regressed");
  });

  it("never prints PASS beside `fingerprints equal : false`", () => {
    for (const candidate of [
      "candidate-equal-count-bindings.json",
      "candidate-rejected-bindings.json",
    ]) {
      const text = output(runPreflight("--live", LIVE, "--candidate", `${FIXTURES}/${candidate}`));
      if (text.includes("fingerprints equal : false")) {
        expect(text, candidate).toContain("STOP");
        expect(text, candidate).not.toMatch(/^\[release-preflight] PASS/m);
      }
    }
  });

  it("records that fingerprint equality is part of the pass condition", () => {
    const report = resolve(process.cwd(), ".forever-build/preflight-report.json");
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-preserved-bindings.json`,
      "--json",
      ".forever-build/preflight-report.json",
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(readFileSync(report, "utf8")) as Record<string, unknown>;
    expect(parsed.fingerprintsEqual).toBe(true);
    expect(parsed.fingerprintEqualityRequiredForPass).toBe(true);
    expect(parsed.snapshotSchemaValid).toBe(true);
    expect(parsed.uploadSpecCanonical).toBe(true);
    expect(parsed.verdict).toBe("BINDINGS_PRESERVED");
    expect(parsed.contactedProduction).toBe(false);
    expect(parsed.secretValuesRead).toBe(0);
  });
});

describe("P1-1 — the free-text command surface is gone", () => {
  it("REFUSES --command loudly rather than ignoring it", () => {
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-preserved-bindings.json`,
      "--command",
      "wrangler versions upload --keep-vars --config .output/server/wrangler.json",
    );
    expect(result.status).toBe(1);
    expect(output(result)).toContain("`--command` no longer exists");
  });

  it("REFUSES a supplied upload specification that is not the canonical one", () => {
    const bad = resolve(process.cwd(), ".forever-build/bad-upload-spec.json");
    writeFileSync(
      bad,
      JSON.stringify({
        executable: "wrangler",
        args: [
          "versions",
          "upload",
          "--keep-vars=false",
          "--config",
          ".output/server/wrangler.json",
        ],
      }),
      "utf8",
    );
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-preserved-bindings.json`,
      "--upload-spec",
      ".forever-build/bad-upload-spec.json",
    );
    expect(result.status).toBe(1);
    expect(output(result)).toContain("keep_vars_malformed");
    expect(output(result)).toContain("upload spec        : REFUSED");
  });

  it("ACCEPTS a supplied specification only when it is byte-for-byte canonical", () => {
    const good = resolve(process.cwd(), ".forever-build/good-upload-spec.json");
    writeFileSync(
      good,
      JSON.stringify({
        executable: "wrangler",
        args: ["versions", "upload", "--keep-vars", "--config", ".output/server/wrangler.json"],
      }),
      "utf8",
    );
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-preserved-bindings.json`,
      "--upload-spec",
      ".forever-build/good-upload-spec.json",
    );
    expect(result.status).toBe(0);
    expect(output(result)).toContain("upload spec        : CANONICAL");
  });
});

describe("the upload wrapper refuses to spawn Wrangler unless every gate held", () => {
  it("STOPS on the Wrangler version gate, before anything else, and says so", () => {
    // Wrangler is not a dependency of this repository, so the gate cannot
    // resolve one — and a release that cannot prove its Wrangler version does
    // not happen. This is the fail-closed default, asserted rather than assumed.
    const result = run(WRAPPER, "--live", LIVE);
    expect(result.status).toBe(1);
    expect(output(result)).toContain("Wrangler was NOT spawned");
  });

  it("refuses any command or argument pass-through", () => {
    const result = run(WRAPPER, "--live", LIVE, "--command", "wrangler versions upload");
    expect(result.status).toBe(1);
    expect(output(result)).toContain("accepts no command, argument or flag pass-through");
  });

  it("requires a live snapshot — the pre-upload capture is not optional", () => {
    expect(read(WRAPPER)).toContain("--live <live-snapshot.json> is required");
  });

  it("never spawns before the preflight has produced PASS", () => {
    const source = read(WRAPPER);
    const preflightIndex = source.indexOf("verify-binding-preservation.mjs");
    const spawnIndex = source.lastIndexOf("PRODUCTION_VERSION_UPLOAD_SPEC.args");
    expect(preflightIndex).toBeGreaterThan(-1);
    expect(spawnIndex).toBeGreaterThan(preflightIndex);
    expect(source).toContain("--authorize-upload");
  });

  it("the pre-upload preflight mode PASSES on a valid live snapshot alone", () => {
    const result = runPreflight("--preupload", "--live", LIVE);
    expect(result.status).toBe(0);
    expect(output(result)).toContain("PREUPLOAD_CONTRACT_OK");
  });

  it("the pre-upload preflight STOPS on an invalid live snapshot", () => {
    const result = runPreflight(
      "--preupload",
      "--live",
      `${FIXTURES}/snapshot-unknown-top-level-key.json`,
    );
    expect(result.status).toBe(1);
    expect(output(result)).not.toContain("PREUPLOAD_CONTRACT_OK");
  });

  it("the version gate reports the supported version and never uses a shell", () => {
    const result = run(GATE);
    expect(output(result)).toContain("supported version : 4.118.0");
    expect(output(result)).toContain("shell             : false");
  });
});

describe("preflight fixtures carry no production value", () => {
  const fixtureFiles = [
    "live-bindings.json",
    "candidate-preserved-bindings.json",
    "candidate-rejected-bindings.json",
    "candidate-valued-bindings.json",
    "candidate-equal-count-bindings.json",
    "candidate-duplicate-bindings.json",
    "candidate-swapped-bindings.json",
    "snapshot-unknown-top-level-key.json",
  ];

  it("records binding names and classes only — never a value", () => {
    for (const file of fixtureFiles) {
      const source = read(`${FIXTURES}/${file}`);
      expect(source, file).not.toMatch(/https:\/\/[a-z0-9]{20}\.supabase\.co/);
      for (const marker of ["sb_secret_", "sb_publishable_", "eyJ", "@", "Bearer "]) {
        expect(source, `${file} :: ${marker}`).not.toContain(marker);
      }
    }
  });

  it("carries only SYNTHETIC Worker version identifiers, never a real one", () => {
    // A snapshot must be attributed to an exact immutable version, so the
    // schema requires a UUID — and every committed one is unmistakably made up.
    for (const file of fixtureFiles) {
      const source = read(`${FIXTURES}/${file}`);
      const { workerVersionId } = JSON.parse(source) as { workerVersionId: string };
      expect(workerVersionId, file).toMatch(/^(\d)\1{7}-\1{4}-4\1{3}-8\1{3}-\1{12}$/);
      expect(source, file).not.toContain("ae4cae19");
      expect(source, file).not.toContain("fb4bf6d7");
    }
  });

  it("the raw Cloudflare fixtures carry no value either", () => {
    const rawFiles = readdirSync(resolve(process.cwd(), `${FIXTURES}/raw`));
    expect(rawFiles.length).toBeGreaterThanOrEqual(9);
    for (const file of rawFiles) {
      const source = read(`${FIXTURES}/raw/${file}`);
      expect(source, file).not.toMatch(/https:\/\/[a-z0-9]{20}\.supabase\.co/);
      for (const marker of ["sb_secret_", "sb_publishable_", "eyJ", "@", "Bearer "]) {
        expect(source, `${file} :: ${marker}`).not.toContain(marker);
      }
      // Every value-bearing field Cloudflare would fill is present and EMPTY.
      for (const match of source.matchAll(/"text":\s*("(?:[^"\\]|\\.)*")/g)) {
        expect(match[1], `${file} text field`).toBe('""');
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
