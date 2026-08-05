/**
 * FOREVER-PINNED-BINDING-INHERITANCE-IMPLEMENTATION-001 — the regression matrix.
 *
 * THE CENTRAL FIXTURE reproduces the measured incident locally, with no
 * Cloudflare contact:
 *
 *   1. a live version carrying TWELVE bindings at 100% of traffic;
 *   2. a NEWER, undeployed version carrying TEN at 0%;
 *   3. generic `keep_vars` as the unsafe IMPLICIT inheritance mechanism, which
 *      resolves against (2) and therefore preserves nothing;
 *   4. explicit `inherit.version_id` pinned to (1), which does not consult the
 *      implicit source at all.
 *
 * Step 3 MUST fail. A fixture that only exercised step 4 would have passed
 * before this incident too, which is exactly why the previous contract's green
 * result meant nothing.
 *
 * WHAT THIS DOES NOT CLAIM. It does not prove undocumented Cloudflare
 * server-side behaviour for `keep_bindings`; no local test can. It proves the
 * corrected architecture is INDEPENDENT of the implicit inheritance source.
 *
 * NO PRODUCTION IDENTIFIER APPEARS HERE. The UUIDs below are synthetic. The
 * real live version UUID is supplied at release time through
 * `--expected-live-version` and is never hard-coded in tracked source.
 */

import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_INHERIT_VERSION,
  INHERIT_BINDING_TYPE,
  PINNED_INHERITANCE_BINDINGS,
  PREUPLOAD_PINNED_INHERITANCE_MARKER,
  SUPERSEDED_PREUPLOAD_MARKER,
  buildPinnedInheritanceBindings,
  buildUploadSpecification,
  declaredBindingNames,
  isPinnableWorkerVersionId,
  normalizeUploadSpecification,
  verifyUploadSpecification,
} from "./pinned-binding-inheritance";
import {
  DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS,
  DEPLOYMENT_MANAGED_SECRET_BINDINGS,
  EXPECTED_PRODUCTION_BINDING_COUNT,
  PRODUCTION_VERSION_UPLOAD_ARGV,
  REPOSITORY_DECLARED_BINDINGS,
  UPLOAD_SPECIFICATION_PATH,
  GENERATED_WORKER_CONFIG_PATH,
  verifyUploadSpec,
} from "./worker-variable-preservation";

/** The verified 12-binding version holding 100% of traffic. Synthetic. */
const LIVE_12_BINDING_VERSION = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
/** The NEWER, failed, undeployed 10-binding candidate at 0%. Synthetic. */
const NEWER_FAILED_10_BINDING_VERSION = "9f8e7d6c-5b4a-4390-8271-6a5b4c3d2e1f";

const [PROVIDER_BINDING, SUPABASE_URL_BINDING] = DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS;

/** The live Worker's twelve binding names: 4 declared + 2 plain-text + 6 secret. */
const LIVE_12_BINDING_NAMES = [
  ...REPOSITORY_DECLARED_BINDINGS,
  ...DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS,
  ...DEPLOYMENT_MANAGED_SECRET_BINDINGS,
];

/** The failed candidate shape: the same set MINUS the two plain-text bindings. */
const FAILED_10_BINDING_NAMES = LIVE_12_BINDING_NAMES.filter(
  (name) => !(DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS as readonly string[]).includes(name),
);

/** A stand-in for the immutable generated deploy configuration. */
function generatedConfig(): Record<string, unknown> {
  return {
    compatibility_date: "2026-07-30",
    name: "forever",
    keep_vars: true,
    observability: { enabled: true, head_sampling_rate: 1 },
    triggers: { crons: ["*/5 * * * *"] },
    r2_buckets: [
      { binding: "R2_PRIVATE_SOURCES", bucket_name: "forever-private-sources" },
      { binding: "R2_PUBLIC_MEDIA", bucket_name: "forever-public-media" },
      { binding: "R2_PROJECT_ARCHIVES", bucket_name: "forever-project-archives" },
    ],
    main: "index.mjs",
    assets: { binding: "ASSETS", directory: "../public" },
    compatibility_flags: ["nodejs_compat"],
    no_bundle: true,
  };
}

/** The passing arrangement, from which every failing case is a single edit. */
function passingInput() {
  return {
    specification: buildUploadSpecification({
      generatedConfig: generatedConfig(),
      expectedLiveVersion: LIVE_12_BINDING_VERSION,
    }),
    generatedConfig: generatedConfig(),
    expectedLiveVersion: LIVE_12_BINDING_VERSION,
    liveSnapshotVersionId: LIVE_12_BINDING_VERSION,
    liveBindingNames: LIVE_12_BINDING_NAMES,
  };
}

/** Mutates the inherit records of a specification in place and returns it. */
function withRecords(
  specification: Record<string, unknown>,
  mutate: (records: Record<string, unknown>[]) => Record<string, unknown>[] | void,
): Record<string, unknown> {
  const unsafe = specification.unsafe as { bindings: Record<string, unknown>[] };
  const next = mutate(unsafe.bindings);
  return {
    ...specification,
    unsafe: { bindings: next ?? unsafe.bindings },
  };
}

const codesOf = (input: Parameters<typeof verifyUploadSpecification>[0]) =>
  verifyUploadSpecification(input).violations.map((violation) => violation.code);

describe("the two bindings permitted to use pinned inheritance", () => {
  it("is exactly SUPABASE_URL and STUDIO_STORAGE_WRITE_PROVIDER, and nothing else", () => {
    expect([...PINNED_INHERITANCE_BINDINGS].sort()).toEqual([
      "STUDIO_STORAGE_WRITE_PROVIDER",
      "SUPABASE_URL",
    ]);
  });

  it("is the SAME list as the deployment-managed plain-text contract, so the two cannot drift", () => {
    expect(PINNED_INHERITANCE_BINDINGS).toBe(DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS);
  });

  it("builds two records that always share ONE source version", () => {
    const records = buildPinnedInheritanceBindings(LIVE_12_BINDING_VERSION);
    expect(records).toHaveLength(2);
    expect(new Set(records.map((record) => record.version_id)).size).toBe(1);
    for (const record of records) {
      expect(record.type).toBe(INHERIT_BINDING_TYPE);
      expect(record.version_id).toBe(LIVE_12_BINDING_VERSION);
      expect(Object.keys(record).sort()).toEqual(["name", "type", "version_id"]);
    }
  });

  it("never hard-codes a production Worker version UUID in tracked source", () => {
    // The pin arrives at release time. A committed UUID would go stale silently
    // and would re-introduce exactly the "inherit from the wrong version" class.
    const source = buildPinnedInheritanceBindings(LIVE_12_BINDING_VERSION);
    expect(source.every((record) => record.version_id === LIVE_12_BINDING_VERSION)).toBe(true);
  });
});

describe("the canonical upload consumes the verified specification", () => {
  it("points --config at the ephemeral upload specification, not the immutable build output", () => {
    const argv = [...PRODUCTION_VERSION_UPLOAD_ARGV];
    expect(argv[argv.indexOf("--config") + 1]).toBe(UPLOAD_SPECIFICATION_PATH);
    expect(argv).not.toContain(GENERATED_WORKER_CONFIG_PATH);
  });

  it("REFUSES an upload that names the immutable generated configuration", () => {
    const verdict = verifyUploadSpec({
      executable: "wrangler",
      args: ["versions", "upload", "--keep-vars", "--config", GENERATED_WORKER_CONFIG_PATH],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map((violation) => violation.code)).toContain("wrong_config_path");
  });

  it("retains --keep-vars as secondary protection for the six secrets", () => {
    expect([...PRODUCTION_VERSION_UPLOAD_ARGV]).toContain("--keep-vars");
    expect(DEPLOYMENT_MANAGED_SECRET_BINDINGS).toHaveLength(6);
  });
});

describe("PASSING CASE — pinned to the verified 12-binding live version", () => {
  it("accepts the specification and records a normalized representation", () => {
    const verdict = verifyUploadSpecification(passingInput());
    expect(verdict.violations).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.normalized).not.toBeNull();
  });

  it("carries exactly two inherit records, both pinned to the live version", () => {
    const specification = passingInput().specification as Record<string, unknown>;
    const records = (specification.unsafe as { bindings: Record<string, unknown>[] }).bindings;
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.name).sort()).toEqual([
      "STUDIO_STORAGE_WRITE_PROVIDER",
      "SUPABASE_URL",
    ]);
    expect(records.every((record) => record.version_id === LIVE_12_BINDING_VERSION)).toBe(true);
  });

  it("leaves the immutable application configuration byte-identical", () => {
    const before = generatedConfig();
    const specification = buildUploadSpecification({
      generatedConfig: before,
      expectedLiveVersion: LIVE_12_BINDING_VERSION,
    });
    // Every key of the build output survives untouched; the ONLY delta is the
    // approved addition.
    for (const [key, value] of Object.entries(before)) {
      expect(specification[key]).toEqual(value);
    }
    const added = Object.keys(specification).filter((key) => !(key in before));
    expect(added).toEqual(["unsafe"]);
    expect(before).toEqual(generatedConfig());
  });

  it("normalizes deterministically regardless of key order", () => {
    const a = buildUploadSpecification({
      generatedConfig: generatedConfig(),
      expectedLiveVersion: LIVE_12_BINDING_VERSION,
    });
    const reordered = Object.fromEntries(Object.entries(a).reverse());
    expect(normalizeUploadSpecification(reordered)).toBe(normalizeUploadSpecification(a));
  });

  it("declares no vars block anywhere", () => {
    expect((passingInput().specification as Record<string, unknown>).vars).toBeUndefined();
  });

  it("introduces no duplicate binding name against the immutable configuration", () => {
    const declared = declaredBindingNames(generatedConfig());
    expect([...declared].sort()).toEqual([
      "ASSETS",
      "R2_PRIVATE_SOURCES",
      "R2_PROJECT_ARCHIVES",
      "R2_PUBLIC_MEDIA",
    ]);
    for (const name of PINNED_INHERITANCE_BINDINGS) expect(declared).not.toContain(name);
  });
});

describe("MANDATORY FAILING CASES", () => {
  it("generic keep_vars as the ONLY protection — the 3540bc64 shape — is REFUSED", () => {
    // The immutable configuration alone: `keep_vars: true`, no vars block, and
    // no pinned inheritance. This is precisely what the superseded contract
    // called PREUPLOAD_CONTRACT_OK, and it preserved nothing.
    const input = { ...passingInput(), specification: generatedConfig() };
    expect(codesOf(input)).toContain("inherit_record_count_wrong");
    expect(verifyUploadSpecification(input).ok).toBe(false);
  });

  it("a MISSING version_id is REFUSED — Cloudflare would default to `latest`", () => {
    const input = passingInput();
    input.specification = withRecords(input.specification as Record<string, unknown>, (records) =>
      records.map(({ name, type }) => ({ name, type })),
    );
    expect(codesOf(input)).toContain("inherit_record_version_missing");
  });

  it('version_id === "latest" is REFUSED — that IS the defect, written explicitly', () => {
    const input = passingInput();
    input.specification = withRecords(input.specification as Record<string, unknown>, (records) =>
      records.map((record) => ({ ...record, version_id: FORBIDDEN_INHERIT_VERSION })),
    );
    expect(codesOf(input)).toContain("inherit_record_version_is_latest");
  });

  it("two records pinned to DIFFERENT versions are REFUSED", () => {
    const input = passingInput();
    input.specification = withRecords(input.specification as Record<string, unknown>, (records) => [
      records[0],
      { ...records[1], version_id: NEWER_FAILED_10_BINDING_VERSION },
    ]);
    const codes = codesOf(input);
    expect(codes).toContain("inherit_records_disagree");
    expect(codes).toContain("inherit_record_version_mismatch");
  });

  it("a record pointing at the NEWER failed 10-binding version is REFUSED", () => {
    const input = passingInput();
    input.specification = buildUploadSpecification({
      generatedConfig: generatedConfig(),
      expectedLiveVersion: NEWER_FAILED_10_BINDING_VERSION,
    });
    expect(codesOf(input)).toContain("inherit_record_version_mismatch");
  });

  it("a STALE expected-live UUID that differs from the snapshot is REFUSED", () => {
    const input = { ...passingInput(), liveSnapshotVersionId: NEWER_FAILED_10_BINDING_VERSION };
    expect(codesOf(input)).toContain("live_snapshot_version_mismatch");
  });

  it("a source snapshot carrying TEN rather than twelve bindings is REFUSED", () => {
    const input = { ...passingInput(), liveBindingNames: FAILED_10_BINDING_NAMES };
    const codes = codesOf(input);
    expect(codes).toContain("live_snapshot_binding_count_wrong");
    expect(FAILED_10_BINDING_NAMES).toHaveLength(EXPECTED_PRODUCTION_BINDING_COUNT - 2);
  });

  it("a source missing ONE required plain-text binding is REFUSED", () => {
    const input = {
      ...passingInput(),
      liveBindingNames: LIVE_12_BINDING_NAMES.filter((name) => name !== SUPABASE_URL_BINDING),
    };
    const codes = codesOf(input);
    expect(codes).toContain("live_snapshot_plain_text_missing");
    expect(codes).toContain("live_snapshot_binding_count_wrong");
  });

  it("an ABSENT inherit record is REFUSED", () => {
    const input = passingInput();
    input.specification = withRecords(input.specification as Record<string, unknown>, (records) => [
      records[0],
    ]);
    expect(codesOf(input)).toContain("inherit_record_count_wrong");
  });

  it("an unexpected THIRD inherit record is REFUSED", () => {
    const input = passingInput();
    input.specification = withRecords(input.specification as Record<string, unknown>, (records) => [
      ...records,
      {
        name: "SUPABASE_SERVICE_ROLE_KEY",
        type: INHERIT_BINDING_TYPE,
        version_id: LIVE_12_BINDING_VERSION,
      },
    ]);
    const codes = codesOf(input);
    expect(codes).toContain("inherit_record_count_wrong");
    expect(codes).toContain("inherit_record_name_wrong");
  });

  it("an extra NON-inherit raw binding is REFUSED", () => {
    // Distinct from the third-inherit-record case: here the inherit count is
    // still exactly two, so only the raw-bindings-length rule can catch it.
    // Without this case that rule is dead code a mutation can delete freely.
    const input = passingInput();
    input.specification = withRecords(input.specification as Record<string, unknown>, (records) => [
      ...records,
      { name: "SMUGGLED_KV", type: "kv_namespace", namespace_id: "0123456789abcdef" },
    ]);
    expect(codesOf(input)).toContain("inherit_record_count_wrong");
    expect(verifyUploadSpecification(input).ok).toBe(false);
  });

  it("DUPLICATE binding names are REFUSED", () => {
    const input = passingInput();
    input.specification = withRecords(input.specification as Record<string, unknown>, (records) => [
      records[0],
      { ...records[0] },
    ]);
    expect(codesOf(input)).toContain("duplicate_binding_name");
  });

  it("a pinned record colliding with a binding the build already declares is REFUSED", () => {
    const config = generatedConfig();
    (config.r2_buckets as Record<string, unknown>[]).push({
      binding: SUPABASE_URL_BINDING,
      bucket_name: "decoy",
    });
    const input = { ...passingInput(), generatedConfig: config };
    expect(codesOf(input)).toContain("duplicate_binding_name");
  });

  it.each(["text", "value", "json", "content"])(
    "a record carrying a `%s` value field is REFUSED unread",
    (field) => {
      const input = passingInput();
      input.specification = withRecords(input.specification as Record<string, unknown>, (records) =>
        records.map((record, index) =>
          index === 0 ? { ...record, [field]: "https://example.invalid" } : record,
        ),
      );
      expect(codesOf(input)).toContain("inherit_record_carries_value");
    },
  );

  it("an unknown key on a record is REFUSED", () => {
    const input = passingInput();
    input.specification = withRecords(input.specification as Record<string, unknown>, (records) =>
      records.map((record, index) => (index === 0 ? { ...record, environment: "prod" } : record)),
    );
    expect(codesOf(input)).toContain("inherit_record_unknown_key");
  });

  it("a specification whose immutable build content was CHANGED is REFUSED", () => {
    const input = passingInput();
    input.specification = {
      ...(input.specification as Record<string, unknown>),
      compatibility_date: "2020-01-01",
    };
    expect(codesOf(input)).toContain("immutable_config_modified");
  });

  it("a specification referencing a DIFFERENT Worker bundle is REFUSED", () => {
    const input = passingInput();
    input.specification = {
      ...(input.specification as Record<string, unknown>),
      main: "other.mjs",
    };
    expect(codesOf(input)).toContain("immutable_config_modified");
  });

  it("a specification referencing a DIFFERENT asset set is REFUSED", () => {
    const input = passingInput();
    input.specification = {
      ...(input.specification as Record<string, unknown>),
      assets: { binding: "ASSETS", directory: "../elsewhere" },
    };
    expect(codesOf(input)).toContain("immutable_config_modified");
  });

  it("a declared vars block is REFUSED — that is the other way to lose the values", () => {
    const input = passingInput();
    input.specification = {
      ...(input.specification as Record<string, unknown>),
      vars: { SUPABASE_URL: "https://example.invalid" },
    };
    const codes = codesOf(input);
    expect(codes).toContain("vars_block_declared");
  });

  it("a missing expected-live version is REFUSED", () => {
    const input = { ...passingInput(), expectedLiveVersion: undefined };
    expect(codesOf(input)).toContain("expected_live_version_missing");
  });

  it('an expected-live version of "latest" is REFUSED', () => {
    const input = { ...passingInput(), expectedLiveVersion: FORBIDDEN_INHERIT_VERSION };
    expect(codesOf(input)).toContain("expected_live_version_is_latest");
  });

  it("an expected-live version that is not a Worker UUID is REFUSED", () => {
    const input = { ...passingInput(), expectedLiveVersion: "047e190e244856e3a2bf22b61ad68986" };
    // A client asset identifier is 32 hex characters and is NOT a version UUID.
    expect(codesOf(input)).toContain("expected_live_version_invalid");
  });
});

describe("the incident, reproduced as a local sequence", () => {
  it("step 3 FAILS and step 4 PASSES against the identical fixture", () => {
    // The whole point. Both steps see the same 12-binding live version and the
    // same newer 10-binding candidate; only the mechanism differs.
    const implicitKeepVarsOnly = verifyUploadSpecification({
      ...passingInput(),
      specification: generatedConfig(),
    });
    const explicitPinned = verifyUploadSpecification(passingInput());

    expect(implicitKeepVarsOnly.ok).toBe(false);
    expect(explicitPinned.ok).toBe(true);
  });

  it("the newer 0% candidate cannot become the inheritance source", () => {
    // Even when the failed candidate is the newest version in existence, the
    // selected source is the supplied, snapshot-verified live UUID.
    const verdict = verifyUploadSpecification(passingInput());
    const records = (
      passingInput().specification as { unsafe: { bindings: Record<string, unknown>[] } }
    ).unsafe.bindings;
    expect(verdict.ok).toBe(true);
    expect(records.every((r) => r.version_id !== NEWER_FAILED_10_BINDING_VERSION)).toBe(true);
  });

  it("keeps the superseded marker out of the new contract", () => {
    expect(PREUPLOAD_PINNED_INHERITANCE_MARKER).toBe("PREUPLOAD_PINNED_INHERITANCE_OK");
    expect(PREUPLOAD_PINNED_INHERITANCE_MARKER).not.toBe(SUPERSEDED_PREUPLOAD_MARKER);
  });
});

describe("no value ever enters this contract", () => {
  it("a built specification contains no value-carrying field on any record", () => {
    const serialized = normalizeUploadSpecification(passingInput().specification);
    const records = (
      passingInput().specification as { unsafe: { bindings: Record<string, unknown>[] } }
    ).unsafe.bindings;
    for (const record of records) {
      for (const forbidden of ["text", "value", "json", "content", "secret_text"]) {
        expect(record[forbidden]).toBeUndefined();
      }
    }
    expect(serialized).not.toMatch(/"text"\s*:/);
    expect(serialized).not.toMatch(/"value"\s*:/);
  });

  it("commits no production value for either deployment-managed variable", () => {
    const serialized = normalizeUploadSpecification(passingInput().specification);
    expect(serialized).not.toMatch(/supabase\.co/);
    expect(serialized).not.toMatch(/https:\/\/[a-z0-9]{15,}\./);
  });

  it("rejects anything that is not an immutable Worker version UUID as a pin", () => {
    expect(isPinnableWorkerVersionId(LIVE_12_BINDING_VERSION)).toBe(true);
    expect(isPinnableWorkerVersionId(FORBIDDEN_INHERIT_VERSION)).toBe(false);
    expect(isPinnableWorkerVersionId("047e190e244856e3a2bf22b61ad68986")).toBe(false);
    expect(isPinnableWorkerVersionId("")).toBe(false);
    expect(isPinnableWorkerVersionId(undefined)).toBe(false);
  });

  it("names the provider binding without ever describing its value", () => {
    expect(PROVIDER_BINDING).toBe("STUDIO_STORAGE_WRITE_PROVIDER");
    expect(SUPABASE_URL_BINDING).toBe("SUPABASE_URL");
  });
});
