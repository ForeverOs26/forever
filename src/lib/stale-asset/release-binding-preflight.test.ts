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
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  PREUPLOAD_EXPLICIT_BINDINGS_MARKER,
  RELEASE_VALUE_ENV_VARS,
  SUPERSEDED_PREUPLOAD_MARKERS,
  buildUploadSpecification,
  projectFinalBindingSet,
} from "./explicit-plain-text-bindings";
import { RELEASE_VALUE_ENV_KEYS } from "./release-child-environment";
import { UPLOAD_SPECIFICATION_PATH } from "./worker-variable-preservation";

const SCRIPT = "scripts/release/verify-binding-preservation.mjs";
const WRAPPER = "scripts/release/upload-worker-version.mjs";
const GATE = "scripts/release/wrangler-version-gate.mjs";
const FIXTURES = "scripts/release/fixtures";
const LIVE = `${FIXTURES}/live-bindings.json`;
const PROVENANCE = `${FIXTURES}/worker-version-provenance.json`;
const LIVE_ID = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_ID = "22222222-2222-4222-8222-222222222222";

/**
 * Two live snapshots that are SCHEMA-VALID and reach the live-snapshot
 * cross-check instead of failing earlier (PR140 review, F1).
 *
 * Both carry a complete, correct twelve-entry projection derived from the good
 * live fixture, so every other rule in `verifyFinalBindingProjection` is
 * satisfied and only the live cross-check can refuse them. A shortened
 * projection would have been refused by the count rule as well, and mutation
 * control 33 would have survived exactly as it did before.
 */
const LIVE_ELEVEN = `${FIXTURES}/live-bindings-eleven.json`;
const LIVE_ELEVEN_ID = "44444444-4444-4444-8444-444444444444";
const LIVE_MISSING_PLAIN_TEXT = `${FIXTURES}/live-bindings-missing-plain-text.json`;
const LIVE_MISSING_PLAIN_TEXT_ID = "55555555-5555-4555-8555-555555555555";

function run(script: string, ...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
}

/**
 * SYNTHETIC values. Never a production value, and never written anywhere the
 * suite asserts against — the origin is a `.test` host that cannot resolve.
 */
const SYNTHETIC_SUPABASE_URL = "https://synthetic-project.supabase.test";
const SYNTHETIC_WRITE_PROVIDER = "r2";
const SYNTHETIC_DIGEST = "a".repeat(64);

/**
 * Writes the VALUE-FREE binding projection a PREUPLOAD run consumes.
 *
 * FOREVER-STUDIO-EXPLICIT-BINDINGS-FIX-002: PREUPLOAD no longer reads the
 * value-carrying specification — it never sees a value at all. It reasons about
 * the projection the wrapper derives, so the tests must derive one the same way,
 * from the real immutable build output plus the two explicit records. Building
 * it any other way would test a fiction.
 */
function writeBindingProjection(
  overrides: Partial<Record<string, unknown>> = {},
  liveBindingNames?: readonly string[],
): string {
  const generatedConfig = JSON.parse(read(".output/server/wrangler.json")) as Record<
    string,
    unknown
  >;
  const names =
    liveBindingNames ??
    (JSON.parse(read(LIVE)) as { bindings: { name: string }[] }).bindings.map(
      (binding) => binding.name,
    );
  const projection = {
    ...projectFinalBindingSet({
      generatedConfig,
      specification: buildUploadSpecification({
        generatedConfig,
        values: {
          SUPABASE_URL: SYNTHETIC_SUPABASE_URL,
          STUDIO_STORAGE_WRITE_PROVIDER: SYNTHETIC_WRITE_PROVIDER,
        },
      }),
      liveBindingNames: names,
    }),
    ...overrides,
  };
  const path = join(
    mkdtempSync(join(tmpdir(), "forever-preflight-projection-")),
    "upload-binding-projection.json",
  );
  writeFileSync(path, `${JSON.stringify(projection, null, 2)}\n`, "utf8");
  return path;
}

const runPreflightUnpinned = (...args: string[]) => run(SCRIPT, ...args);
const runPreflight = (...args: string[]) => {
  if (args.includes("--preupload")) {
    const index = args.indexOf("--expected-live-version");
    return run(
      SCRIPT,
      ...args,
      ...(args.includes("--upload-binding-projection")
        ? []
        : ["--upload-binding-projection", writeBindingProjection()]),
      ...(args.includes("--upload-specification-digest")
        ? []
        : ["--upload-specification-digest", SYNTHETIC_DIGEST]),
      ...(index !== -1 ? [] : ["--expected-live-version", LIVE_ID]),
    );
  }
  return run(
    SCRIPT,
    ...args,
    ...(args.includes("--release-provenance") ? [] : ["--release-provenance", PROVENANCE]),
  );
};
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

describe("exact immutable Worker version provenance — fail-closed, executed", () => {
  const writeJson = (name: string, value: unknown) => {
    const path = `.forever-build/${name}.json`;
    writeFileSync(resolve(process.cwd(), path), `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return path;
  };
  const snapshotWithId = (source: string, workerVersionId: string, name: string) => {
    const parsed = JSON.parse(read(source)) as Record<string, unknown>;
    return writeJson(name, { ...parsed, workerVersionId });
  };
  const provenance = (
    previousWorkerVersionId = LIVE_ID,
    candidateWorkerVersionId = CANDIDATE_ID,
    name = "version-provenance",
  ) =>
    writeJson(name, {
      schemaVersion: 1,
      previousWorkerVersionId,
      candidateWorkerVersionId,
    });

  it("PREUPLOAD_EXACT_LIVE_UUID: accepts only the discovered deployed Worker UUID", () => {
    const pass = runPreflight("--preupload", "--live", LIVE);
    expect(pass.status).toBe(0);
    expect(output(pass)).toContain("version identity    : PINNED");

    const wrong = runPreflight(
      "--preupload",
      "--live",
      LIVE,
      "--expected-live-version",
      "99999999-9999-4999-8999-999999999999",
    );
    expect(wrong.status).toBe(1);
    expect(output(wrong)).toContain("live_worker_version_mismatch");
    expect(output(wrong)).toContain("snapshot_version_mismatch");
  });

  it("PREUPLOAD_PROVENANCE_REQUIRED: refuses omitted and malformed discovery UUIDs", () => {
    const missing = runPreflightUnpinned("--preupload", "--live", LIVE);
    expect(missing.status).toBe(1);
    expect(output(missing)).toContain("release_provenance_missing");

    const malformed = runPreflightUnpinned(
      "--preupload",
      "--live",
      LIVE,
      "--expected-live-version",
      "not-a-worker-uuid",
    );
    expect(malformed.status).toBe(1);
    expect(output(malformed)).toContain("release_provenance_invalid");
  });

  it("POSTUPLOAD_EXACT_UUIDS: accepts the exact previous and upload-returned candidate pair", () => {
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-preserved-bindings.json`,
    );
    expect(result.status).toBe(0);
    expect(output(result)).toContain("version identity    : PINNED");
  });

  it("SAME_SNAPSHOT_REFUSED: refuses one file supplied as live and candidate", () => {
    const result = runPreflight("--live", LIVE, "--candidate", LIVE);
    expect(result.status).toBe(1);
    expect(output(result)).toContain("same_snapshot_input");
    expect(output(result)).not.toMatch(/^\[release-preflight] PASS/m);
  });

  it("SAME_WORKER_UUID_REFUSED: refuses the same Worker UUID in two different files", () => {
    const duplicateIdentity = snapshotWithId(LIVE, LIVE_ID, "candidate-same-worker-id");
    const result = runPreflight("--live", LIVE, "--candidate", duplicateIdentity);
    expect(result.status).toBe(1);
    expect(output(result)).toContain("candidate_worker_version_mismatch");
  });

  it("WRONG_CANDIDATE_UUID_REFUSED: exact bindings cannot substitute a retained candidate", () => {
    const wrongCandidate = snapshotWithId(
      `${FIXTURES}/candidate-preserved-bindings.json`,
      "33333333-3333-4333-8333-333333333333",
      "candidate-wrong-worker-id",
    );
    const result = runPreflight("--live", LIVE, "--candidate", wrongCandidate);
    expect(result.status).toBe(1);
    expect(output(result)).toContain("candidate_worker_version_mismatch");
    expect(output(result)).toContain("snapshot_version_mismatch");
  });

  it("WRONG_LIVE_UUID_REFUSED: exact bindings cannot substitute an older live snapshot", () => {
    const wrongLive = snapshotWithId(
      LIVE,
      "99999999-9999-4999-8999-999999999999",
      "older-live-worker-id",
    );
    const result = runPreflight(
      "--live",
      wrongLive,
      "--candidate",
      `${FIXTURES}/candidate-preserved-bindings.json`,
    );
    expect(result.status).toBe(1);
    expect(output(result)).toContain("live_worker_version_mismatch");
    expect(output(result)).toContain("snapshot_version_mismatch");
  });

  it("CANDIDATE_NOT_PREVIOUS: the canonical receipt refuses an equal version pair", () => {
    const equalReceipt = provenance(LIVE_ID, LIVE_ID, "candidate-equals-previous");
    const result = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      snapshotWithId(LIVE, LIVE_ID, "equal-version-candidate"),
      "--release-provenance",
      equalReceipt,
    );
    expect(result.status).toBe(1);
    expect(output(result)).toContain("candidate_worker_version_not_new");
  });

  it("SWAPPED_IDENTITIES_REFUSED: exact fingerprints do not excuse swapped roles", () => {
    const result = runPreflight(
      "--live",
      `${FIXTURES}/candidate-preserved-bindings.json`,
      "--candidate",
      snapshotWithId(LIVE, LIVE_ID, "swapped-candidate"),
    );
    expect(result.status).toBe(1);
    expect(output(result)).toContain("live_worker_version_mismatch");
    expect(output(result)).toContain("candidate_worker_version_mismatch");
  });

  it("RELEASE_PROVENANCE_REQUIRED: missing and padded receipts STOP", () => {
    const missing = runPreflightUnpinned(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-preserved-bindings.json`,
    );
    expect(missing.status).toBe(1);
    expect(output(missing)).toContain("release_provenance_missing");
    expect(output(missing)).toContain("candidate_receipt_missing");

    const padded = writeJson("padded-version-receipt", {
      schemaVersion: 1,
      previousWorkerVersionId: LIVE_ID,
      candidateWorkerVersionId: CANDIDATE_ID,
      rawOutput: "CANARY_MUST_NOT_BE_ACCEPTED",
    });
    const invalid = runPreflight(
      "--live",
      LIVE,
      "--candidate",
      `${FIXTURES}/candidate-preserved-bindings.json`,
      "--release-provenance",
      padded,
    );
    expect(invalid.status).toBe(1);
    expect(output(invalid)).toContain("release_provenance_invalid");
    expect(output(invalid)).not.toContain("CANARY_MUST_NOT_BE_ACCEPTED");
  });

  it("PREVIEW_GATE_BLOCKED: no postupload identity PASS means no preview acceptance", () => {
    const report = ".forever-build/preview-blocked-report.json";
    const wrongCandidate = snapshotWithId(
      `${FIXTURES}/candidate-preserved-bindings.json`,
      "33333333-3333-4333-8333-333333333333",
      "preview-blocked-candidate",
    );
    const result = runPreflight("--live", LIVE, "--candidate", wrongCandidate, "--json", report);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(read(report)) as Record<string, unknown>;
    expect(parsed.workerVersionIdentityOk).toBe(false);
    expect(parsed.verdict).toBe("STOP");
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
    expect(parsed.releaseProvenanceValid).toBe(true);
    expect(parsed.liveWorkerVersionMatches).toBe(true);
    expect(parsed.candidateWorkerVersionMatches).toBe(true);
    expect(parsed.workerVersionIdentityOk).toBe(true);
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
        args: [
          "versions",
          "upload",
          "--keep-vars",
          "--config",
          ".output/server/wrangler.upload.json",
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
      ".forever-build/good-upload-spec.json",
    );
    expect(result.status).toBe(0);
    expect(output(result)).toContain("upload spec        : CANONICAL");
  });
});

describe("the upload wrapper refuses to spawn Wrangler unless every gate held", () => {
  it("STOPS without a complete invocation, and says Wrangler was not spawned", () => {
    // The comment this replaces claimed the STOP came from Wrangler being
    // unresolvable. It has not for some time: Wrangler is a locked
    // devDependency, so the gate PASSES here and the refusal is the missing
    // `--expected-live-version`. Corrected under
    // FOREVER-PR139-REVIEW-CORRECTIONS-001 §6 — a comment must state what is
    // proven, and the gate's own refusal is proven separately below.
    const result = run(WRAPPER, "--live", LIVE);
    expect(result.status).toBe(1);
    expect(output(result)).toContain("Wrangler was NOT spawned");
    // Explicit, because this spawns a Node process that jiti-compiles the
    // TypeScript release contracts before it can refuse anything. Vitest's 5s
    // default is not a budget for that under a loaded full-suite run.
  }, 120_000);

  it("EXTERNAL_WRANGLER_REJECTED: STOPS before any upload-capable path on a foreign WRANGLER_BIN", () => {
    // FOREVER-PR139-REVIEW-CORRECTIONS-001, P1-1, at the WRAPPER boundary. An
    // external executable reporting exactly the supported version is refused by
    // identity, and the wrapper never reaches the specification, the preflight
    // or a spawn. The fixture records every execution of itself and records
    // none.
    const scratch = mkdtempSync(join(tmpdir(), "forever-foreign-wrangler-"));
    const marker = join(scratch, "invocations.log");
    const foreign = join(scratch, "wrangler.js");
    writeFileSync(marker, "", "utf8");
    writeFileSync(
      foreign,
      `require("node:fs").appendFileSync(${JSON.stringify(marker)}, "invoked\\n");\n` +
        `process.stdout.write("4.118.0\\n");\n`,
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [WRAPPER, "--live", LIVE, "--expected-live-version", LIVE_ID],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", WRANGLER_BIN: foreign },
      },
    );

    expect(result.status).toBe(1);
    expect(output(result)).toContain("the Wrangler version gate refused");
    expect(output(result)).toContain("Wrangler was NOT spawned");
    expect(output(result)).toContain("NOT the repository-locked Wrangler");
    expect(readFileSync(marker, "utf8")).toBe("");
  }, 120_000);

  it("refuses any command or argument pass-through", () => {
    const result = run(WRAPPER, "--live", LIVE, "--command", "wrangler versions upload");
    expect(result.status).toBe(1);
    expect(output(result)).toContain("accepts no command, argument or flag pass-through");
  }, 120_000);

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

  it("the pre-upload preflight mode PASSES on a valid live snapshot and explicit projection", () => {
    const result = runPreflight("--preupload", "--live", LIVE);
    expect(result.status).toBe(0);
    expect(output(result)).toContain(PREUPLOAD_EXPLICIT_BINDINGS_MARKER);
    expect(output(result)).toContain("inherit records    : 0");
    expect(output(result)).toContain("projected bindings : 12");
    // Both superseded markers described contracts that did not hold — one
    // verified INTENT, the other verified a mechanism the API rejects with
    // HTTP 400. Neither is ever emitted again.
    for (const superseded of SUPERSEDED_PREUPLOAD_MARKERS) {
      expect(output(result)).not.toContain(superseded);
    }
  });

  it("the pre-upload preflight STOPS on an invalid live snapshot", () => {
    const result = runPreflight(
      "--preupload",
      "--live",
      `${FIXTURES}/snapshot-unknown-top-level-key.json`,
    );
    expect(result.status).toBe(1);
    expect(output(result)).not.toContain(PREUPLOAD_EXPLICIT_BINDINGS_MARKER);
  });

  it("PREUPLOAD_EXPLICIT_STOPS: refuses when the projection is missing entirely", () => {
    // Generic keep_vars as the only protection is exactly candidate 3540bc64.
    const result = runPreflightUnpinned(
      "--preupload",
      "--live",
      LIVE,
      "--expected-live-version",
      LIVE_ID,
      "--upload-binding-projection",
      `${FIXTURES}/does-not-exist.json`,
      "--upload-specification-digest",
      SYNTHETIC_DIGEST,
    );
    expect(result.status).toBe(1);
    expect(output(result)).toContain("specification_malformed");
    expect(output(result)).not.toContain(PREUPLOAD_EXPLICIT_BINDINGS_MARKER);
  });

  it("PREUPLOAD_EXPLICIT_STOPS: refuses a projection carrying any inherit record", () => {
    const result = runPreflight(
      "--preupload",
      "--live",
      LIVE,
      "--upload-binding-projection",
      writeBindingProjection({ inheritRecordCount: 1 }),
    );
    expect(result.status).toBe(1);
    expect(output(result)).toContain("inherit_record_present");
    expect(output(result)).toContain("10057");
    expect(output(result)).not.toContain(PREUPLOAD_EXPLICIT_BINDINGS_MARKER);
  });

  it("PREUPLOAD_EXPLICIT_STOPS: refuses a projection that lost a plain-text binding", () => {
    const projection = writeBindingProjection();
    const parsed = JSON.parse(readFileSync(projection, "utf8")) as {
      bindings: { name: string }[];
    };
    const shortened = writeBindingProjection({
      bindings: parsed.bindings.filter((binding) => binding.name !== "SUPABASE_URL"),
    });
    const result = runPreflight(
      "--preupload",
      "--live",
      LIVE,
      "--upload-binding-projection",
      shortened,
    );
    expect(result.status).toBe(1);
    expect(output(result)).toContain("SUPABASE_URL");
    expect(output(result)).toContain("final_binding_count_wrong");
    expect(output(result)).not.toContain(PREUPLOAD_EXPLICIT_BINDINGS_MARKER);
  });

  /**
   * MUTATION CONTROL 33, reached through the EXECUTED preflight (PR140 review,
   * F1).
   *
   * The contract-level proof lives in `explicit-plain-text-bindings.test.ts`.
   * This is the same gate reached the way a release reaches it: a committed
   * snapshot that satisfies the closed schema, an expected-live UUID that
   * matches it, and a complete, correct projection — so the ONLY thing wrong is
   * the live Worker the release proposes to reproduce.
   */
  it("PREUPLOAD_LIVE_SNAPSHOT: refuses a schema-valid live snapshot with fewer than twelve", () => {
    const result = runPreflight(
      "--preupload",
      "--live",
      LIVE_ELEVEN,
      "--expected-live-version",
      LIVE_ELEVEN_ID,
      // Derived from the GOOD live fixture: a complete, correct twelve.
      "--upload-binding-projection",
      writeBindingProjection(),
    );
    const text = output(result);

    expect(result.status).toBe(1);
    expect(text).toContain("live_snapshot_binding_count_wrong");
    expect(text).toContain("live bindings      : 11");
    expect(text).toContain("explicit bindings  : REFUSED");
    expect(text).not.toContain(PREUPLOAD_EXPLICIT_BINDINGS_MARKER);
    // Nothing else fired: the projection itself is correct.
    expect(text).not.toContain("final_binding_count_wrong");
    expect(text).not.toContain("preserved_binding_missing");
  });

  it("PREUPLOAD_LIVE_SNAPSHOT: refuses a twelve-binding live snapshot missing a plain-text name", () => {
    const result = runPreflight(
      "--preupload",
      "--live",
      LIVE_MISSING_PLAIN_TEXT,
      "--expected-live-version",
      LIVE_MISSING_PLAIN_TEXT_ID,
      "--upload-binding-projection",
      writeBindingProjection(),
    );
    const text = output(result);

    expect(result.status).toBe(1);
    expect(text).toContain("live_snapshot_plain_text_missing");
    expect(text).toContain("SUPABASE_URL");
    // The COUNT rule is satisfied — twelve live names — so this is the second
    // live-snapshot rule refusing on its own.
    expect(text).toContain("live bindings      : 12");
    expect(text).not.toContain("live_snapshot_binding_count_wrong");
    expect(text).not.toContain(PREUPLOAD_EXPLICIT_BINDINGS_MARKER);
  });

  it("PREUPLOAD_EXPLICIT_STOPS: refuses a missing or malformed specification digest", () => {
    for (const digest of [undefined, "not-a-digest"]) {
      const result = runPreflightUnpinned(
        "--preupload",
        "--live",
        LIVE,
        "--expected-live-version",
        LIVE_ID,
        "--upload-binding-projection",
        writeBindingProjection(),
        ...(digest === undefined ? [] : ["--upload-specification-digest", digest]),
      );
      expect(result.status).toBe(1);
      expect(output(result)).not.toContain(PREUPLOAD_EXPLICIT_BINDINGS_MARKER);
    }
  });

  it("PREUPLOAD_EXPLICIT_RECORDS: a passing run records the specification digest", () => {
    const result = runPreflight("--preupload", "--live", LIVE);
    // The upload wrapper re-hashes the file immediately before spawning, so the
    // digest is what binds "verified" to "consumed".
    expect(output(result)).toMatch(/upload spec digest : [0-9a-f]{64}/);
  });

  it("PREUPLOAD_VALUE_FREE: the preflight never prints a binding value", () => {
    const result = runPreflight("--preupload", "--live", LIVE);
    expect(output(result)).not.toContain(SYNTHETIC_SUPABASE_URL);
    expect(output(result)).not.toContain("supabase.test");
  });

  it("the version gate reports the supported version and never uses a shell", () => {
    const result = run(GATE);
    expect(output(result)).toContain("supported version : 4.118.0");
    expect(output(result)).toContain("shell             : false");
  }, 120_000);
});

/**
 * FOREVER-PR140-CORRECTIONS-002 — the REAL wrapper, end to end, offline.
 *
 * Everything below runs `scripts/release/upload-worker-version.mjs` itself, with
 * synthetic release inputs and WITHOUT `--authorize-upload`, and measures what
 * the run actually did rather than what its source says.
 *
 * HOW A CHILD'S ENVIRONMENT IS OBSERVED. A tiny reporter is preloaded through
 * `NODE_OPTIONS=--require`, which Node applies to the wrapper AND to every Node
 * child that inherits its environment. On load it appends ONE line naming the
 * script and stating, as booleans, whether the release-input keys are present
 * and whether any environment value equals the sentinel. The sentinel itself
 * never crosses back, so no assertion here can print it.
 *
 * The wrapper's own record is the NON-VACUITY control: the wrapper legitimately
 * holds both inputs, so the reporter must see them there. A reporter that saw
 * nothing anywhere would report "absent" for a child it never observed.
 */
describe("the real upload wrapper, offline, with synthetic release inputs", () => {
  /** Synthetic. A reserved `.test` host that cannot resolve. Never printed. */
  const SENTINEL_SUPABASE_URL = "https://wrapper-sentinel.supabase.test";
  const SENTINEL_WRITE_PROVIDER = "r2";

  const REPORTER_SOURCE = `
const fs = require("node:fs");
const path = require("node:path");
const log = process.env.FOREVER_CHILD_ENV_REPORT_LOG;
if (log) {
  const releaseKeys = ${JSON.stringify(RELEASE_VALUE_ENV_KEYS)};
  const sentinel = ${JSON.stringify(SENTINEL_SUPABASE_URL)};
  fs.appendFileSync(
    log,
    JSON.stringify({
      script: process.argv[1] ? path.basename(process.argv[1]) : "(none)",
      releaseKeysPresent: releaseKeys.filter((key) => key in process.env),
      sentinelValueSeen: Object.values(process.env).some((value) => value === sentinel),
    }) + "\\n",
  );
}
`;

  interface ChildRecord {
    readonly script: string;
    readonly releaseKeysPresent: string[];
    readonly sentinelValueSeen: boolean;
  }

  interface WrapperRun {
    readonly status: number | null;
    readonly text: string;
    readonly records: ChildRecord[];
    readonly workDirectoriesLeftBehind: string[];
  }

  const releaseWorkDirectories = () =>
    readdirSync(tmpdir()).filter(
      (entry) =>
        entry.startsWith("forever-release-work-") || entry.startsWith("forever-wrangler-output-"),
    );

  /** Runs the wrapper with the reporter installed and collects everything. */
  function runWrapperOffline(extraArgs: readonly string[] = []): WrapperRun {
    const scratch = mkdtempSync(join(tmpdir(), "forever-wrapper-observed-"));
    const reporter = join(scratch, "report-child-environment.cjs");
    const logPath = join(scratch, "child-environments.jsonl");
    writeFileSync(reporter, REPORTER_SOURCE, "utf8");
    writeFileSync(logPath, "", "utf8");

    const before = new Set(releaseWorkDirectories());
    try {
      const run = spawnSync(
        process.execPath,
        [WRAPPER, "--live", LIVE, "--expected-live-version", LIVE_ID, ...extraArgs],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          shell: false,
          env: {
            ...process.env,
            FORCE_COLOR: "0",
            NO_COLOR: "1",
            // Forward slashes: Node accepts them on every platform, and they
            // avoid any question of how NODE_OPTIONS treats a backslash.
            NODE_OPTIONS: `--require ${reporter.replace(/\\/g, "/")}`,
            FOREVER_CHILD_ENV_REPORT_LOG: logPath,
            [RELEASE_VALUE_ENV_VARS.SUPABASE_URL]: SENTINEL_SUPABASE_URL,
            [RELEASE_VALUE_ENV_VARS.STUDIO_STORAGE_WRITE_PROVIDER]: SENTINEL_WRITE_PROVIDER,
          },
        },
      );
      const records = readFileSync(logPath, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as ChildRecord);
      return {
        status: run.status,
        text: `${run.stdout ?? ""}${run.stderr ?? ""}`,
        records,
        workDirectoriesLeftBehind: releaseWorkDirectories().filter((entry) => !before.has(entry)),
      };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  const recordFor = (run: WrapperRun, script: string) =>
    run.records.find((record) => record.script === script);

  /** ONE authorization-free run, measured many ways. Spawning is expensive. */
  let dryRun: WrapperRun;
  beforeAll(() => {
    dryRun = runWrapperOffline();
  }, 240_000);

  it("completes the DRY RUN with every gate held", () => {
    expect(dryRun.text, dryRun.text).toContain("DRY RUN");
    expect(dryRun.text).toContain(PREUPLOAD_EXPLICIT_BINDINGS_MARKER);
    expect(dryRun.status).toBe(0);
  });

  it("REPORTER_NOT_VACUOUS: the wrapper's own process shows both release inputs", () => {
    const wrapper = recordFor(dryRun, basename(WRAPPER));

    expect(wrapper, "the reporter never observed the wrapper process").toBeDefined();
    // The wrapper is the one process permitted to hold them. If the reporter
    // could not see them HERE, its silence about the child would prove nothing.
    expect([...(wrapper?.releaseKeysPresent ?? [])].sort()).toEqual(
      [...RELEASE_VALUE_ENV_KEYS].sort(),
    );
    expect(wrapper?.sentinelValueSeen).toBe(true);
  });

  it("PREUPLOAD_CHILD_STRIPPED: the preflight child receives NEITHER release input", () => {
    const preflight = recordFor(dryRun, "verify-binding-preservation.mjs");

    expect(preflight, "the preflight child never ran").toBeDefined();
    expect(preflight?.releaseKeysPresent).toEqual([]);
    // Nor the value under some other name.
    expect(preflight?.sentinelValueSeen).toBe(false);
  });

  it("NO_LAUNCHER_WITHOUT_AUTHORIZATION: no Wrangler upload child is started", () => {
    // The upload spawn inherits the wrapper's environment, so a Wrangler child
    // started by it would carry the reporter and appear in this log — the
    // preflight record above proves inherited children ARE observed. The version
    // probe deliberately runs under a constructed environment and is therefore
    // outside this measurement; it performs no upload.
    expect(dryRun.records.map((record) => record.script)).not.toContain("wrangler.js");
    expect(dryRun.text).toContain("this program does not authorize one");
  });

  it("writes NO value-carrying file and leaves NO temporary directory behind", () => {
    expect(existsSync(resolve(process.cwd(), UPLOAD_SPECIFICATION_PATH))).toBe(false);
    expect(dryRun.workDirectoriesLeftBehind).toEqual([]);
  });

  it("echoes NEITHER value, in stdout or stderr", () => {
    expect(dryRun.text.includes(SENTINEL_SUPABASE_URL)).toBe(false);
    expect(dryRun.text.includes("supabase.test")).toBe(false);
    // The variable NAMES are printed — that is how an operator knows what to
    // set — and the values are not.
    for (const key of RELEASE_VALUE_ENV_KEYS) expect(dryRun.text).toContain(key);
  });

  it("STOPS when a specification from another run is already present, and preserves it", () => {
    // The documented fail-closed refusal. The pre-existing file belongs to a
    // crashed or concurrent release and is evidence, so it is neither
    // overwritten nor deleted — see also the exclusive-create race tests in
    // `explicit-plain-text-bindings.test.ts`.
    const specification = resolve(process.cwd(), UPLOAD_SPECIFICATION_PATH);
    const foreign = '{"owner":"another release"}\n';
    writeFileSync(specification, foreign, "utf8");
    try {
      const run = runWrapperOffline();

      expect(run.status).toBe(1);
      expect(run.text).toContain("already exists");
      expect(run.text).toContain("Wrangler was NOT spawned");
      expect(readFileSync(specification, "utf8")).toBe(foreign);
      expect(run.records.map((record) => record.script)).not.toContain("wrangler.js");
      expect(run.workDirectoriesLeftBehind).toEqual([]);
    } finally {
      rmSync(specification, { force: true });
    }
  }, 180_000);
});

describe("preflight fixtures carry no production value", () => {
  const fixtureFiles = [
    "live-bindings.json",
    "live-bindings-eleven.json",
    "live-bindings-missing-plain-text.json",
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
