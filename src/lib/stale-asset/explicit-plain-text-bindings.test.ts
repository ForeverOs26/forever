/**
 * FOREVER-STUDIO-EXPLICIT-BINDINGS-FIX-002 — the explicit-binding contract.
 *
 * The mechanism these tests defend replaced pinned `inherit` bindings after the
 * production API refused those outright:
 *
 *   POST /accounts/{account_id}/workers/scripts/forever/versions -> HTTP 400
 *   "'version_id' value '<uuid>' is invalid, only the literal 'latest' is
 *    supported by this API [code: 10057]"
 *
 * So the suite asserts BOTH halves: that an explicit twelve-binding upload is
 * accepted, and that every route back to the refused mechanism — an inherit
 * record, `"latest"`, a version UUID — is a STOP.
 *
 * EVERY VALUE HERE IS SYNTHETIC. The origin is a `.test` host that cannot
 * resolve and the provider is a documented identifier. No production value
 * appears in this file, and several tests exist specifically to prove no value
 * escapes into a message, a projection or a log line.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  removeEphemeralSpecification,
  withEphemeralSpecification,
  writeEphemeralSpecification,
} from "./ephemeral-upload-specification";
import {
  BINDINGS_PRESERVED_WITHOUT_EXPLICIT_RECORDS,
  EXPECTED_FINAL_BINDING_COUNT,
  EXPLICIT_PLAIN_TEXT_BINDINGS,
  PREUPLOAD_EXPLICIT_BINDINGS_MARKER,
  RELEASE_VALUE_ENV_VARS,
  REFUSED_INHERIT_BINDING_TYPE,
  REFUSED_INHERIT_LATEST,
  SUPERSEDED_PREUPLOAD_MARKERS,
  buildUploadSpecification,
  isAcceptableSupabaseUrl,
  isAcceptableWriteProvider,
  normalizeUploadSpecification,
  projectFinalBindingSet,
  readReleaseBindingInputs,
  verifyFinalBindingProjection,
  verifyUploadSpecification,
} from "./explicit-plain-text-bindings";
import {
  UPLOAD_SPECIFICATION_DIGEST_MISMATCH_STOP,
  UPLOAD_SPECIFICATION_STRUCTURE_INVALID_STOP,
  verifyThenLaunchUpload,
} from "./release-upload-orchestration";
import {
  DEPLOYMENT_MANAGED_SECRET_BINDINGS,
  REPOSITORY_DECLARED_BINDINGS,
} from "./worker-variable-preservation";

/* ---- synthetic fixtures --------------------------------------------------- */

const SUPABASE_URL = "https://synthetic-project.supabase.test";
const WRITE_PROVIDER = "r2";
const VALUES = {
  SUPABASE_URL,
  STUDIO_STORAGE_WRITE_PROVIDER: WRITE_PROVIDER,
} as const;

const LIVE_VERSION_UUID = "11111111-1111-4111-8111-111111111111";

const GENERATED_CONFIG: Record<string, unknown> = {
  name: "forever",
  main: "index.js",
  compatibility_date: "2026-07-30",
  keep_vars: true,
  assets: { binding: "ASSETS", directory: "../public" },
  r2_buckets: [
    { binding: "R2_PRIVATE_SOURCES", bucket_name: "synthetic-private" },
    { binding: "R2_PUBLIC_MEDIA", bucket_name: "synthetic-public" },
    { binding: "R2_PROJECT_ARCHIVES", bucket_name: "synthetic-archives" },
  ],
};

const LIVE_BINDING_NAMES = [
  ...REPOSITORY_DECLARED_BINDINGS,
  ...EXPLICIT_PLAIN_TEXT_BINDINGS,
  ...DEPLOYMENT_MANAGED_SECRET_BINDINGS,
];

const validSpecification = () =>
  buildUploadSpecification({ generatedConfig: GENERATED_CONFIG, values: VALUES });

const validProjection = () =>
  projectFinalBindingSet({
    generatedConfig: GENERATED_CONFIG,
    specification: validSpecification(),
    liveBindingNames: LIVE_BINDING_NAMES,
  });

const verifySpec = (specification: unknown) =>
  verifyUploadSpecification({ specification, generatedConfig: GENERATED_CONFIG, values: VALUES });

const codes = (result: { violations: readonly { code: string }[] }) =>
  result.violations.map((violation) => violation.code);

const allText = (result: { violations: readonly { code: string; detail: string }[] }) =>
  result.violations.map((violation) => `${violation.code} ${violation.detail}`).join("\n");

/** A specification whose `unsafe.bindings` array is replaced wholesale. */
function specificationWithRecords(records: unknown[]): Record<string, unknown> {
  return { ...GENERATED_CONFIG, unsafe: { bindings: records } };
}

const temporaryPaths: string[] = [];
function temporaryPath(name = "wrangler.upload.json"): string {
  const path = join(mkdtempSync(join(tmpdir(), "forever-ephemeral-spec-")), name);
  temporaryPaths.push(path);
  return path;
}
afterEach(() => {
  while (temporaryPaths.length > 0) removeEphemeralSpecification(temporaryPaths.pop() as string);
});

/* ---- 1. the accepted configuration ---------------------------------------- */

describe("1. a valid twelve-binding explicit configuration", () => {
  it("is ACCEPTED by the value-aware contract", () => {
    const result = verifySpec(validSpecification());
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.normalized).not.toBeNull();
  });

  it("declares exactly the two deployment-managed plain-text bindings, as plain_text", () => {
    const records = (validSpecification().unsafe as { bindings: Record<string, unknown>[] })
      .bindings;
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.name).sort()).toEqual(
      [...EXPLICIT_PLAIN_TEXT_BINDINGS].sort(),
    );
    for (const record of records) {
      expect(record.type).toBe("plain_text");
      expect(Object.keys(record).sort()).toEqual(["name", "text", "type"]);
    }
  });

  it("projects exactly twelve bindings and PASSES the value-free contract", () => {
    const projection = validProjection();
    expect(projection.bindings).toHaveLength(EXPECTED_FINAL_BINDING_COUNT);
    expect(EXPECTED_FINAL_BINDING_COUNT).toBe(12);

    const verdict = verifyFinalBindingProjection({
      projection,
      liveBindingNames: LIVE_BINDING_NAMES,
    });
    expect(verdict.violations).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.bindingCount).toBe(12);
  });

  it("keeps all ten bindings that survive WITHOUT explicit records", () => {
    expect(BINDINGS_PRESERVED_WITHOUT_EXPLICIT_RECORDS).toHaveLength(10);
    const projected = validProjection().bindings.map((binding) => binding.name);
    for (const name of BINDINGS_PRESERVED_WITHOUT_EXPLICIT_RECORDS) {
      expect(projected, name).toContain(name);
    }
  });

  it("REFUSES a projection that dropped one of those ten", () => {
    const projection = validProjection();
    const verdict = verifyFinalBindingProjection({
      projection: {
        ...projection,
        bindings: projection.bindings.filter((binding) => binding.name !== "R2_PUBLIC_MEDIA"),
      },
      liveBindingNames: LIVE_BINDING_NAMES,
    });
    expect(codes(verdict)).toContain("preserved_binding_missing");
    expect(verdict.ok).toBe(false);
  });

  it("emits a marker that names what it proved, and never a superseded one", () => {
    expect(PREUPLOAD_EXPLICIT_BINDINGS_MARKER).toBe("PREUPLOAD_EXPLICIT_BINDINGS_OK");
    expect(SUPERSEDED_PREUPLOAD_MARKERS).toContain("PREUPLOAD_PINNED_INHERITANCE_OK");
    expect(SUPERSEDED_PREUPLOAD_MARKERS).toContain("PREUPLOAD_CONTRACT_OK");
    for (const superseded of SUPERSEDED_PREUPLOAD_MARKERS) {
      expect(PREUPLOAD_EXPLICIT_BINDINGS_MARKER).not.toBe(superseded);
    }
  });
});

/* ---- 2, 7, 8, 9. inheritance is gone, by every route ---------------------- */

describe("2/7/8/9. inheritance is removed, not reconfigured", () => {
  it("a valid specification carries ZERO inherit records", () => {
    const records = (validSpecification().unsafe as { bindings: Record<string, unknown>[] })
      .bindings;
    expect(records.filter((record) => record.type === REFUSED_INHERIT_BINDING_TYPE)).toHaveLength(
      0,
    );
    expect(validProjection().inheritRecordCount).toBe(0);
    expect(JSON.stringify(validSpecification())).not.toContain(REFUSED_INHERIT_BINDING_TYPE);
  });

  for (const name of EXPLICIT_PLAIN_TEXT_BINDINGS) {
    it(`REFUSES an inherit record for ${name}`, () => {
      const result = verifySpec(
        specificationWithRecords([
          { name, type: REFUSED_INHERIT_BINDING_TYPE, version_id: LIVE_VERSION_UUID },
          {
            name: EXPLICIT_PLAIN_TEXT_BINDINGS.find((other) => other !== name),
            type: "plain_text",
            text: "supabase",
          },
        ]),
      );
      expect(codes(result)).toContain("inherit_record_present");
      expect(result.ok).toBe(false);
    });
  }

  it(`REFUSES the literal "${REFUSED_INHERIT_LATEST}" as an inheritance source`, () => {
    const result = verifySpec(
      specificationWithRecords(
        EXPLICIT_PLAIN_TEXT_BINDINGS.map((name) => ({
          name,
          type: REFUSED_INHERIT_BINDING_TYPE,
          version_id: REFUSED_INHERIT_LATEST,
        })),
      ),
    );
    expect(codes(result)).toContain("inherit_record_present");
    expect(result.ok).toBe(false);
  });

  it("REFUSES a version UUID as an inheritance source — the measured HTTP 400", () => {
    const result = verifySpec(
      specificationWithRecords(
        EXPLICIT_PLAIN_TEXT_BINDINGS.map((name) => ({
          name,
          type: REFUSED_INHERIT_BINDING_TYPE,
          version_id: LIVE_VERSION_UUID,
        })),
      ),
    );
    expect(codes(result)).toContain("inherit_record_present");
    expect(allText(result)).toContain("10057");
    expect(result.ok).toBe(false);
  });

  it("REFUSES a non-zero inherit count in the value-free projection", () => {
    const verdict = verifyFinalBindingProjection({
      projection: { ...validProjection(), inheritRecordCount: 1 },
      liveBindingNames: LIVE_BINDING_NAMES,
    });
    expect(codes(verdict)).toContain("inherit_record_present");
    expect(verdict.ok).toBe(false);
  });

  it("REFUSES a projected binding whose class is inherit", () => {
    const projection = validProjection();
    const verdict = verifyFinalBindingProjection({
      projection: {
        ...projection,
        bindings: projection.bindings.map((binding) =>
          binding.name === "SUPABASE_URL"
            ? { name: binding.name, type: REFUSED_INHERIT_BINDING_TYPE }
            : binding,
        ),
      },
      liveBindingNames: LIVE_BINDING_NAMES,
    });
    expect(codes(verdict)).toContain("inherit_record_present");
    expect(verdict.ok).toBe(false);
  });
});

/* ---- 3, 4, 5. the required inputs ----------------------------------------- */

describe("3/4/5. required release inputs, fail-closed BEFORE any spawn", () => {
  const complete = {
    [RELEASE_VALUE_ENV_VARS.SUPABASE_URL]: SUPABASE_URL,
    [RELEASE_VALUE_ENV_VARS.STUDIO_STORAGE_WRITE_PROVIDER]: WRITE_PROVIDER,
  };

  it("ACCEPTS a complete, valid environment", () => {
    const result = readReleaseBindingInputs(complete);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.values).toEqual(VALUES);
  });

  it("STOPS when SUPABASE_URL has no release input", () => {
    const result = readReleaseBindingInputs({
      [RELEASE_VALUE_ENV_VARS.STUDIO_STORAGE_WRITE_PROVIDER]: WRITE_PROVIDER,
    });
    expect(codes(result)).toContain("release_input_missing");
    expect(allText(result)).toContain(RELEASE_VALUE_ENV_VARS.SUPABASE_URL);
    expect(result.ok).toBe(false);
    expect(result.values).toBeNull();
  });

  it("STOPS when STUDIO_STORAGE_WRITE_PROVIDER has no release input", () => {
    const result = readReleaseBindingInputs({
      [RELEASE_VALUE_ENV_VARS.SUPABASE_URL]: SUPABASE_URL,
    });
    expect(codes(result)).toContain("release_input_missing");
    expect(allText(result)).toContain(RELEASE_VALUE_ENV_VARS.STUDIO_STORAGE_WRITE_PROVIDER);
    expect(result.ok).toBe(false);
  });

  it("NEVER defaults the provider, even though the runtime documents one", () => {
    const result = readReleaseBindingInputs({
      [RELEASE_VALUE_ENV_VARS.SUPABASE_URL]: SUPABASE_URL,
    });
    expect(result.values).toBeNull();
    // `supabase` is the RUNTIME default. Applying it during a release would
    // silently reconfigure production storage.
    expect(allText(result)).toContain("no default");
  });

  it("STOPS on an empty or whitespace-only input", () => {
    for (const empty of ["", "   ", "\t"]) {
      const result = readReleaseBindingInputs({
        ...complete,
        [RELEASE_VALUE_ENV_VARS.SUPABASE_URL]: empty,
      });
      expect(codes(result), empty).toContain("release_input_empty");
      expect(result.ok).toBe(false);
    }
  });

  it("STOPS on a malformed SUPABASE_URL", () => {
    for (const malformed of [
      "not-a-url",
      "http://insecure.supabase.test",
      "https://nodot",
      "https://user:pw@synthetic.supabase.test",
      "https://synthetic.supabase.test/rest/v1",
      "https://synthetic.supabase.test?key=1",
      " https://synthetic.supabase.test",
    ]) {
      expect(isAcceptableSupabaseUrl(malformed), malformed).toBe(false);
      const result = readReleaseBindingInputs({
        ...complete,
        [RELEASE_VALUE_ENV_VARS.SUPABASE_URL]: malformed,
      });
      expect(codes(result), malformed).toContain("supabase_url_invalid");
    }
    expect(isAcceptableSupabaseUrl(SUPABASE_URL)).toBe(true);
  });

  it("STOPS on a provider outside the studio-types contract", () => {
    for (const malformed of ["r3", "S3", " r2 ", "R2", "supabase,r2"]) {
      expect(isAcceptableWriteProvider(malformed), malformed).toBe(false);
      const result = readReleaseBindingInputs({
        ...complete,
        [RELEASE_VALUE_ENV_VARS.STUDIO_STORAGE_WRITE_PROVIDER]: malformed,
      });
      expect(codes(result), malformed).toContain("write_provider_invalid");
    }
    for (const accepted of ["supabase", "r2"]) {
      expect(isAcceptableWriteProvider(accepted), accepted).toBe(true);
    }
  });

  it("REFUSES a specification whose record carries an empty value", () => {
    const result = verifySpec(
      specificationWithRecords([
        { name: "SUPABASE_URL", type: "plain_text", text: SUPABASE_URL },
        { name: "STUDIO_STORAGE_WRITE_PROVIDER", type: "plain_text", text: "  " },
      ]),
    );
    expect(codes(result)).toContain("binding_record_value_missing");
    expect(result.ok).toBe(false);
  });

  it("REFUSES a specification that omits a required binding entirely", () => {
    const result = verifySpec(
      specificationWithRecords([{ name: "SUPABASE_URL", type: "plain_text", text: SUPABASE_URL }]),
    );
    expect(codes(result)).toContain("binding_record_count_wrong");
    expect(allText(result)).toContain("STUDIO_STORAGE_WRITE_PROVIDER");
    expect(result.ok).toBe(false);
  });
});

/* ---- 6. duplicates -------------------------------------------------------- */

describe("6. duplicate binding names", () => {
  it("REFUSES the same explicit binding declared twice", () => {
    const result = verifySpec(
      specificationWithRecords([
        { name: "SUPABASE_URL", type: "plain_text", text: SUPABASE_URL },
        { name: "SUPABASE_URL", type: "plain_text", text: SUPABASE_URL },
      ]),
    );
    expect(codes(result)).toContain("duplicate_binding_name");
    expect(result.ok).toBe(false);
  });

  it("REFUSES an explicit record that collides with a build-declared binding", () => {
    const result = verifyUploadSpecification({
      specification: specificationWithRecords([
        { name: "ASSETS", type: "plain_text", text: SUPABASE_URL },
        { name: "R2_PUBLIC_MEDIA", type: "plain_text", text: WRITE_PROVIDER },
      ]),
      generatedConfig: GENERATED_CONFIG,
      values: VALUES,
    });
    expect(codes(result)).toContain("binding_record_name_wrong");
    expect(result.ok).toBe(false);
  });

  it("REFUSES a duplicate in the value-free projection", () => {
    const projection = validProjection();
    const verdict = verifyFinalBindingProjection({
      projection: {
        ...projection,
        bindings: [...projection.bindings, { name: "SUPABASE_URL", type: "plain_text" }],
      },
      liveBindingNames: LIVE_BINDING_NAMES,
    });
    expect(codes(verdict)).toContain("duplicate_binding_name");
    expect(verdict.ok).toBe(false);
  });

  it("REFUSES a vars block, which replaces the deployment-managed set", () => {
    const result = verifySpec({ ...validSpecification(), vars: { SUPABASE_URL } });
    expect(codes(result)).toContain("vars_block_declared");

    const verdict = verifyFinalBindingProjection({
      projection: { ...validProjection(), varsBlockDeclared: true },
      liveBindingNames: LIVE_BINDING_NAMES,
    });
    expect(codes(verdict)).toContain("vars_block_declared");
  });
});

/* ---- 10. no value ever escapes -------------------------------------------- */

describe("10. values never reach output, projections, receipts or messages", () => {
  const leaks = (text: string) =>
    text.includes(SUPABASE_URL) || text.includes("supabase.test") || /\br2\b/.test(text);

  it("no violation message quotes a rejected value", () => {
    const malformed = "https://leaked-secret-origin.invalid/path?token=abcdef";
    const inputResult = readReleaseBindingInputs({
      [RELEASE_VALUE_ENV_VARS.SUPABASE_URL]: malformed,
      [RELEASE_VALUE_ENV_VARS.STUDIO_STORAGE_WRITE_PROVIDER]: "leaked-provider-value",
    });
    const text = allText(inputResult);
    expect(text).not.toContain(malformed);
    expect(text).not.toContain("leaked-secret-origin");
    expect(text).not.toContain("leaked-provider-value");
    expect(text).not.toContain("abcdef");
  });

  it("no specification violation quotes the value it rejected", () => {
    const result = verifySpec(
      specificationWithRecords([
        { name: "SUPABASE_URL", type: "plain_text", text: "https://leaked.example.invalid/x" },
        { name: "STUDIO_STORAGE_WRITE_PROVIDER", type: "plain_text", text: "leaked-provider" },
      ]),
    );
    expect(allText(result)).not.toContain("leaked.example.invalid");
    expect(allText(result)).not.toContain("leaked-provider");
  });

  it("the value-free projection carries no value at all", () => {
    const serialized = JSON.stringify(validProjection());
    expect(serialized).not.toContain(SUPABASE_URL);
    expect(serialized).not.toContain("supabase.test");
    for (const entry of validProjection().bindings) {
      expect(Object.keys(entry).sort()).toEqual(["name", "type"]);
    }
  });

  it("REFUSES a projection that smuggled a third field beside name and type", () => {
    const projection = validProjection();
    const verdict = verifyFinalBindingProjection({
      projection: {
        ...projection,
        bindings: projection.bindings.map((binding) =>
          binding.name === "SUPABASE_URL" ? { ...binding, text: SUPABASE_URL } : binding,
        ),
      },
      liveBindingNames: LIVE_BINDING_NAMES,
    });
    expect(codes(verdict)).toContain("specification_malformed");
    expect(verdict.ok).toBe(false);
  });

  it("secrets are name-only and are never materialized by the upload", () => {
    const specification = JSON.stringify(validSpecification());
    for (const secret of DEPLOYMENT_MANAGED_SECRET_BINDINGS) {
      // The secret NAME appears nowhere in the uploaded document: the upload
      // declares only the two plain-text bindings, and Cloudflare keeps the rest.
      expect(specification, secret).not.toContain(secret);
    }
    // It appears in the value-free projection, as a name and a class only.
    for (const entry of validProjection().bindings.filter(
      (binding) => binding.type === "secret_text",
    )) {
      expect(Object.keys(entry).sort()).toEqual(["name", "type"]);
    }
  });

  it("REFUSES a record that carries a secret-shaped value field", () => {
    const result = verifySpec(
      specificationWithRecords([
        {
          name: "SUPABASE_URL",
          type: "plain_text",
          text: SUPABASE_URL,
          secret_text: "synthetic-secret",
        },
        { name: "STUDIO_STORAGE_WRITE_PROVIDER", type: "plain_text", text: WRITE_PROVIDER },
      ]),
    );
    expect(codes(result)).toContain("secret_binding_materialized");
    expect(allText(result)).not.toContain("synthetic-secret");
  });

  it("a passing verdict leaks nothing through its own violation list", () => {
    const result = verifySpec(validSpecification());
    expect(leaks(allText(result))).toBe(false);
  });
});

/* ---- 11, 12. the ephemeral file is always removed -------------------------- */

describe("11/12. the value-carrying specification never outlives the spawn", () => {
  it("is REMOVED after a successful run", () => {
    const path = temporaryPath();
    let sawFileDuringRun = false;

    const outcome = withEphemeralSpecification({
      absolutePath: path,
      body: normalizeUploadSpecification(validSpecification()),
      run: () => {
        sawFileDuringRun = existsSync(path);
        return "uploaded";
      },
    });

    expect(sawFileDuringRun).toBe(true);
    expect(outcome).toBe("uploaded");
    expect(existsSync(path)).toBe(false);
  });

  it("is REMOVED after a Wrangler FAILURE — the case a trailing rmSync misses", () => {
    const path = temporaryPath();

    // A non-zero Wrangler exit is a returned result, not a throw.
    const decision = withEphemeralSpecification({
      absolutePath: path,
      body: normalizeUploadSpecification(validSpecification()),
      run: () => ({ status: 1 }),
    });

    expect(decision.status).toBe(1);
    expect(existsSync(path)).toBe(false);
  });

  it("is REMOVED when the run THROWS, and the error still propagates", () => {
    const path = temporaryPath();

    expect(() =>
      withEphemeralSpecification({
        absolutePath: path,
        body: normalizeUploadSpecification(validSpecification()),
        run: () => {
          throw new Error("wrangler could not be executed");
        },
      }),
    ).toThrow("wrangler could not be executed");

    expect(existsSync(path)).toBe(false);
  });

  it("REFUSES to overwrite a specification left behind by another run", () => {
    const path = temporaryPath();
    writeFileSync(path, "{}\n", "utf8");
    expect(() => writeEphemeralSpecification(path, "{}\n")).toThrow();
  });

  it("leaves no value on disk once the run is over", () => {
    const path = temporaryPath();
    withEphemeralSpecification({
      absolutePath: path,
      body: normalizeUploadSpecification(validSpecification()),
      run: () => {
        expect(readFileSync(path, "utf8")).toContain(SUPABASE_URL);
        return null;
      },
    });
    expect(existsSync(path)).toBe(false);
  });
});

/* ---- 13, 14, 15. the spawn gate ------------------------------------------- */

describe("13/14/15. the spawn is guarded, single-attempt and never automatic", () => {
  const generatedPath = () => {
    const path = temporaryPath("wrangler.json");
    writeFileSync(path, JSON.stringify(GENERATED_CONFIG), "utf8");
    return path;
  };

  it("14. a specification changed after verification NEVER reaches the launcher", () => {
    const specificationPath = temporaryPath();
    const configPath = generatedPath();
    const body = normalizeUploadSpecification(validSpecification());
    writeFileSync(specificationPath, body, "utf8");

    let launched = 0;
    const digest = (raw: string) => `salted:${raw.length}`;

    // Tamper AFTER the digest was agreed.
    writeFileSync(specificationPath, `${body} `, "utf8");

    const decision = verifyThenLaunchUpload({
      specificationPath,
      verifiedDigest: digest(body),
      digest,
      generatedConfigPath: configPath,
      generatedBytesBefore: readFileSync(configPath),
      launch: () => {
        launched += 1;
        return "spawned";
      },
    });

    expect(decision.stop).toBe(UPLOAD_SPECIFICATION_DIGEST_MISMATCH_STOP);
    expect(decision.launched).toBe(false);
    expect(launched).toBe(0);
  });

  it("14. a structurally invalid specification NEVER reaches the launcher", () => {
    const specificationPath = temporaryPath();
    const configPath = generatedPath();
    // Structurally wrong — an inherit record — but internally consistent, so
    // only the structure re-check can catch it.
    const tampered = normalizeUploadSpecification(
      specificationWithRecords(
        EXPLICIT_PLAIN_TEXT_BINDINGS.map((name) => ({
          name,
          type: REFUSED_INHERIT_BINDING_TYPE,
          version_id: LIVE_VERSION_UUID,
        })),
      ),
    );
    writeFileSync(specificationPath, tampered, "utf8");

    let launched = 0;
    const decision = verifyThenLaunchUpload({
      specificationPath,
      verifiedDigest: `salted:${tampered.length}`,
      digest: (raw) => `salted:${raw.length}`,
      generatedConfigPath: configPath,
      generatedBytesBefore: readFileSync(configPath),
      revalidate: (raw) => {
        const verdict = verifySpec(JSON.parse(raw));
        return { ok: verdict.ok, detail: codes(verdict).join(",") };
      },
      launch: () => {
        launched += 1;
        return "spawned";
      },
    });

    expect(decision.stop).toBe(UPLOAD_SPECIFICATION_STRUCTURE_INVALID_STOP);
    expect(decision.launched).toBe(false);
    expect(launched).toBe(0);
    expect(decision.message).toContain("inherit_record_present");
  });

  it("15. launches EXACTLY ONCE when every guard holds, and never loops", () => {
    const specificationPath = temporaryPath();
    const configPath = generatedPath();
    const body = normalizeUploadSpecification(validSpecification());
    writeFileSync(specificationPath, body, "utf8");

    let launched = 0;
    const decision = verifyThenLaunchUpload({
      specificationPath,
      verifiedDigest: `salted:${body.length}`,
      digest: (raw) => `salted:${raw.length}`,
      generatedConfigPath: configPath,
      generatedBytesBefore: readFileSync(configPath),
      revalidate: (raw) => {
        const verdict = verifySpec(JSON.parse(raw));
        return { ok: verdict.ok, detail: "" };
      },
      // A non-zero exit is RETURNED. Nothing here retries it, and there is no
      // loop for a caller to re-enter.
      launch: () => {
        launched += 1;
        return { status: 1 };
      },
    });

    expect(decision.launched).toBe(true);
    expect(launched).toBe(1);
    expect(decision.result).toEqual({ status: 1 });
  });

  it("13. the wrapper spawns Wrangler only behind the exact authorization flag", () => {
    const wrapper = readFileSync("scripts/release/upload-worker-version.mjs", "utf8");
    // The dry run returns BEFORE the upload section, so every path that reaches
    // the launcher passes the flag check first.
    const authorizationIndex = wrapper.indexOf('if (!has("--authorize-upload"))');
    const launchIndex = wrapper.indexOf("verifyThenLaunchUpload({");
    expect(authorizationIndex).toBeGreaterThan(-1);
    expect(launchIndex).toBeGreaterThan(authorizationIndex);
    // And the dry run must not write the value-carrying file at all.
    expect(wrapper).toContain("NO value-carrying file was written");
  });

  it("15. the wrapper states the single-attempt contract on its failure path", () => {
    const wrapper = readFileSync("scripts/release/upload-worker-version.mjs", "utf8");
    expect(wrapper).toContain("never retries automatically");
    expect(wrapper).not.toMatch(/for\s*\([^)]*attempt/i);
    expect(wrapper).not.toMatch(/while\s*\([^)]*retr/i);
  });
});
