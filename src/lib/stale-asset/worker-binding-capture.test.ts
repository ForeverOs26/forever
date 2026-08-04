/**
 * FOREVER-PR138-MERGE-BLOCKER-CORRECTION-002 — mechanical capture, executed.
 *
 * PR138 independent review, P1-2: the preflight consumed sanitized JSON that
 * NOTHING in the repository produced, so every release would have required an
 * operator to read Cloudflare's version metadata by eye — metadata in which
 * `plain_text` carries the production value in a `text` field — and hand-write
 * the file the gate then checked. A file transcribed from an expectation
 * confirms the expectation.
 *
 * This suite runs the real capture script against raw fixtures in Cloudflare's
 * documented version-detail shape, and proves the two things that matter:
 *
 *   1. every raw binding is ACCOUNTED FOR — one descriptor each, none dropped,
 *      none invented, an unknown type a STOP rather than an omission;
 *   2. nothing but a NAME and a CLASS survives — proved with a loud canary
 *      value in a disposable fixture, which must appear in no output, no error
 *      and no written file.
 *
 * NO NETWORK, NO CREDENTIAL. Offline review mode only; authorized release mode
 * is never invoked here and this suite holds no Cloudflare authorization.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  BINDING_SNAPSHOT_SCHEMA_VERSION,
  CLOUDFLARE_BINDING_TYPE_MAP,
  WORKER_VERSION_DETAIL_PATH,
  normalizeWorkerVersionDetail,
  validateBindingSnapshot,
} from "./worker-binding-capture";

const CAPTURE = "scripts/release/capture-worker-version-bindings.mjs";
const RAW = "scripts/release/fixtures/raw";
const FIXTURES = "scripts/release/fixtures";

const LIVE_ID = "11111111-1111-4111-8111-111111111111";
const PRESERVED_ID = "22222222-2222-4222-8222-222222222222";
const REJECTED_ID = "33333333-3333-4333-8333-333333333333";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const readRaw = (name: string) => JSON.parse(read(`${RAW}/${name}`)) as unknown;

const scratch = mkdtempSync(resolve(tmpdir(), "forever-capture-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function runCapture(...args: string[]) {
  return spawnSync(process.execPath, [CAPTURE, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
}

const codes = (problems: readonly { code: string }[]) => problems.map((problem) => problem.code);

describe("the Cloudflare API contract this capture is written against", () => {
  it("names the documented account-level version-detail path", () => {
    expect(WORKER_VERSION_DETAIL_PATH).toBe(
      "/accounts/{account_id}/workers/scripts/{script_name}/versions/{version_id}",
    );
  });

  it("reads bindings from result.resources.bindings and nowhere else", () => {
    const source = read("src/lib/stale-asset/worker-binding-capture.ts");
    expect(source).toContain("result.resources.bindings");
    // No second endpoint family is guessed at.
    expect(source).not.toContain("dispatch_namespaces");
    expect(source).not.toContain("/workers/dispatch/");
  });

  it("maps exactly four Cloudflare types, explicitly", () => {
    expect(Object.keys(CLOUDFLARE_BINDING_TYPE_MAP).sort()).toEqual([
      "assets",
      "plain_text",
      "r2_bucket",
      "secret_text",
    ]);
    expect(Object.values(CLOUDFLARE_BINDING_TYPE_MAP).sort()).toEqual([
      "assets",
      "plain_text",
      "r2_bucket",
      "secret_text",
    ]);
  });

  it("the raw fixtures carry the documented shape, including the value-bearing field", () => {
    const raw = readRaw("version-detail-live.json") as {
      success: boolean;
      result: { id: string; resources: { bindings: Array<Record<string, unknown>> } };
    };
    expect(raw.success).toBe(true);
    expect(raw.result.id).toBe(LIVE_ID);
    expect(raw.result.resources.bindings).toHaveLength(12);
    // `text` is where Cloudflare returns the production value. It is present in
    // the fixture — carrying nothing — precisely so the capture can be PROVED
    // to drop it rather than assumed to.
    const plainText = raw.result.resources.bindings.filter(
      (binding) => binding.type === "plain_text",
    );
    expect(plainText).toHaveLength(2);
    for (const binding of plainText) expect(binding).toHaveProperty("text");
    const r2 = raw.result.resources.bindings.filter((binding) => binding.type === "r2_bucket");
    for (const binding of r2) expect(binding).toHaveProperty("bucket_name");
  });
});

describe("normalization accounts for every raw binding", () => {
  it("the complete live version normalizes to exactly 12 descriptors", () => {
    const result = normalizeWorkerVersionDetail(readRaw("version-detail-live.json"), {
      expectedVersionId: LIVE_ID,
    });
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.rawBindingCount).toBe(12);
    expect(result.snapshot?.bindings).toHaveLength(12);
    // input count === sanitized count, measured rather than asserted by eye.
    expect(result.snapshot?.bindings.length).toBe(result.rawBindingCount);
  });

  it("the complete candidate version normalizes to exactly 12 descriptors", () => {
    const result = normalizeWorkerVersionDetail(
      readRaw("version-detail-candidate-preserved.json"),
      { expectedVersionId: PRESERVED_ID },
    );
    expect(result.ok).toBe(true);
    expect(result.snapshot?.bindings).toHaveLength(12);
  });

  it("the failed candidate normalizes to exactly 10 descriptors — the ae4cae19 shape", () => {
    const result = normalizeWorkerVersionDetail(readRaw("version-detail-candidate-rejected.json"), {
      expectedVersionId: REJECTED_ID,
    });
    expect(result.ok).toBe(true);
    expect(result.rawBindingCount).toBe(10);
    expect(result.snapshot?.bindings).toHaveLength(10);
    expect(result.snapshot?.bindings.filter((b) => b.type === "plain_text")).toHaveLength(0);
    expect(result.snapshot?.bindings.filter((b) => b.type === "secret_text")).toHaveLength(6);
  });

  it("keeps only name and type — no bucket_name, no text, no extra key", () => {
    const result = normalizeWorkerVersionDetail(readRaw("version-detail-live.json"), {
      expectedVersionId: LIVE_ID,
    });
    for (const binding of result.snapshot?.bindings ?? []) {
      expect(Object.keys(binding).sort()).toEqual(["name", "type"]);
    }
  });

  it("STOPS on an unknown Cloudflare binding type — never omits it", () => {
    const result = normalizeWorkerVersionDetail(
      readRaw("version-detail-unknown-binding-type.json"),
      {
        expectedVersionId: LIVE_ID,
      },
    );
    expect(result.ok).toBe(false);
    expect(codes(result.problems)).toContain("unknown_cloudflare_binding_type");
    expect(result.snapshot).toBeNull();
    // A silent omission would have produced a 12-descriptor snapshot that
    // agreed with a Worker carrying 13 bindings.
    expect(result.rawBindingCount).toBe(13);
  });

  it("STOPS on a duplicate binding name in the raw response", () => {
    const result = normalizeWorkerVersionDetail(readRaw("version-detail-duplicate-binding.json"), {
      expectedVersionId: LIVE_ID,
    });
    expect(result.ok).toBe(false);
    expect(codes(result.problems)).toContain("duplicate_binding_name");
  });

  it("STOPS when the returned version id is not the requested one", () => {
    const result = normalizeWorkerVersionDetail(readRaw("version-detail-wrong-version-id.json"), {
      expectedVersionId: LIVE_ID,
    });
    expect(result.ok).toBe(false);
    expect(codes(result.problems)).toContain("version_id_mismatch");
  });

  it("STOPS on missing resources, missing bindings and a malformed response", () => {
    expect(
      codes(
        normalizeWorkerVersionDetail(readRaw("version-detail-missing-resources.json"), {
          expectedVersionId: LIVE_ID,
        }).problems,
      ),
    ).toContain("missing_resources");
    expect(
      codes(
        normalizeWorkerVersionDetail(readRaw("version-detail-missing-bindings.json"), {
          expectedVersionId: LIVE_ID,
        }).problems,
      ),
    ).toContain("missing_bindings");
    expect(
      codes(
        normalizeWorkerVersionDetail(readRaw("version-detail-malformed.json"), {
          expectedVersionId: LIVE_ID,
        }).problems,
      ),
    ).toContain("response_not_successful");
  });

  it("STOPS on a response that is not an object, and on a bad requested id", () => {
    expect(
      codes(normalizeWorkerVersionDetail("not json", { expectedVersionId: LIVE_ID }).problems),
    ).toContain("response_not_object");
    expect(
      codes(normalizeWorkerVersionDetail({}, { expectedVersionId: "not-a-uuid" }).problems),
    ).toContain("invalid_worker_version_id");
  });
});

describe("the raw response never reaches disk, stdout, stderr or an error", () => {
  /** Unmistakable, disposable, and present in EVERY value-bearing raw field. */
  const CANARY = "FOREVER_CANARY_c0ffee_MUST_NEVER_BE_PERSISTED_8Q7X";

  function plantCanary(name: string): string {
    const raw = JSON.parse(read(`${RAW}/${name}`)) as {
      result: { resources: { bindings: Array<Record<string, unknown>> } };
    };
    for (const binding of raw.result.resources.bindings) {
      if (binding.type === "plain_text" || binding.type === "secret_text") binding.text = CANARY;
      if (binding.type === "r2_bucket") binding.bucket_name = CANARY;
    }
    const path = resolve(scratch, `canary-${name}`);
    writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    return path;
  }

  it("a plain_text binding carrying a value produces a snapshot without it", () => {
    const source = plantCanary("version-detail-live.json");
    expect(readFileSync(source, "utf8")).toContain(CANARY); // the input really has it

    const out = resolve(scratch, "canary-out.json");
    const result = runCapture(
      "--from-version-detail",
      source,
      "--version-id",
      LIVE_ID,
      "--out",
      out,
    );

    expect(result.status).toBe(0);
    const written = readFileSync(out, "utf8");
    expect(written).not.toContain(CANARY);
    expect(`${result.stdout}${result.stderr}`).not.toContain(CANARY);

    const snapshot = JSON.parse(written) as { bindings: Array<Record<string, unknown>> };
    expect(snapshot.bindings).toHaveLength(12);
    for (const binding of snapshot.bindings) {
      expect(Object.keys(binding).sort()).toEqual(["name", "type"]);
    }
  });

  it("writes ONE file and no copy of the raw response beside it", () => {
    const source = plantCanary("version-detail-candidate-preserved.json");
    const dir = mkdtempSync(resolve(scratch, "outdir-"));
    const out = resolve(dir, "candidate.json");
    expect(
      runCapture("--from-version-detail", source, "--version-id", PRESERVED_ID, "--out", out)
        .status,
    ).toBe(0);

    const produced = readdirSync(dir);
    expect(produced).toEqual(["candidate.json"]);
    expect(readFileSync(out, "utf8")).not.toContain(CANARY);
  });

  it("writes NOTHING when the capture STOPS", () => {
    const dir = mkdtempSync(resolve(scratch, "nothing-"));
    const out = resolve(dir, "should-not-exist.json");
    const result = runCapture(
      "--from-version-detail",
      `${RAW}/version-detail-unknown-binding-type.json`,
      "--version-id",
      LIVE_ID,
      "--out",
      out,
    );
    expect(result.status).toBe(1);
    expect(existsSync(out)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("does not echo a canary through a STOP path either", () => {
    const raw = JSON.parse(read(`${RAW}/version-detail-unknown-binding-type.json`)) as {
      result: { resources: { bindings: Array<Record<string, unknown>> } };
    };
    for (const binding of raw.result.resources.bindings) binding.text = CANARY;
    const source = resolve(scratch, "canary-unknown.json");
    writeFileSync(source, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    const result = runCapture(
      "--from-version-detail",
      source,
      "--version-id",
      LIVE_ID,
      "--out",
      resolve(scratch, "unreachable.json"),
    );
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain(CANARY);
    expect(`${result.stdout}${result.stderr}`).toContain("unknown_cloudflare_binding_type");
  });

  it("the capture source never writes or logs the raw response", () => {
    const source = read(CAPTURE);
    expect(source).not.toMatch(/writeFileSync\([^)]*raw(?:Detail|Response)/);
    expect(source).not.toMatch(/JSON\.stringify\(\s*raw(?:Detail|Response)/);
    expect(source).not.toMatch(/console\.log\(\s*raw/);
    // The only thing written is the serialized snapshot.
    expect(source).toContain("serializeBindingSnapshot(normalized.snapshot)");
  });
});

describe("the committed sanitized fixtures are mechanically reproducible", () => {
  it("capturing the raw live fixture reproduces the committed live snapshot byte-for-byte", () => {
    const out = resolve(scratch, "reproduced-live.json");
    expect(
      runCapture(
        "--from-version-detail",
        `${RAW}/version-detail-live.json`,
        "--version-id",
        LIVE_ID,
        "--out",
        out,
      ).status,
    ).toBe(0);
    expect(readFileSync(out, "utf8")).toBe(read(`${FIXTURES}/live-bindings.json`));
  });

  it("capturing the raw rejected fixture reproduces the committed ten-binding snapshot", () => {
    const out = resolve(scratch, "reproduced-rejected.json");
    expect(
      runCapture(
        "--from-version-detail",
        `${RAW}/version-detail-candidate-rejected.json`,
        "--version-id",
        REJECTED_ID,
        "--out",
        out,
      ).status,
    ).toBe(0);
    expect(readFileSync(out, "utf8")).toBe(read(`${FIXTURES}/candidate-rejected-bindings.json`));
  });

  it("offline review mode refuses to run without a raw fixture, and never calls Cloudflare", () => {
    const result = runCapture("--version-id", LIVE_ID, "--out", resolve(scratch, "no.json"));
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("--from-version-detail");
    expect(read(CAPTURE)).toContain("--authorize-release");
  });
});

describe("the CLOSED sanitized snapshot schema", () => {
  const valid = {
    schemaVersion: BINDING_SNAPSHOT_SCHEMA_VERSION,
    workerVersionId: LIVE_ID,
    bindings: [{ name: "ASSETS", type: "assets" }],
  };

  it("accepts exactly the three documented top-level keys", () => {
    const verdict = validateBindingSnapshot(valid);
    expect(verdict.problems).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("REJECTS every unknown top-level key, including the one the old fixtures carried", () => {
    for (const key of [
      "_note",
      "values",
      "secrets",
      "environment",
      "raw",
      "metadata",
      "response",
      "account",
      "token",
      "credentials",
    ]) {
      const verdict = validateBindingSnapshot({ ...valid, [key]: "anything" });
      expect(verdict.ok, key).toBe(false);
      expect(codes(verdict.problems), key).toContain("unknown_top_level_key");
      // The KEY is named so the operator can fix it; the VALUE never is.
      expect(JSON.stringify(verdict.problems), key).not.toContain("anything");
    }
  });

  it("REJECTS a nested value object stored beside the array", () => {
    const verdict = validateBindingSnapshot({
      ...valid,
      values: { SUPABASE_URL: { text: "CANARY_NESTED_VALUE" } },
    });
    expect(verdict.ok).toBe(false);
    expect(JSON.stringify(verdict.problems)).not.toContain("CANARY_NESTED_VALUE");
  });

  it("REJECTS every disallowed descriptor key", () => {
    for (const key of ["text", "value", "json", "secret", "id", "namespace_id", "bucket_name"]) {
      const verdict = validateBindingSnapshot({
        ...valid,
        bindings: [{ name: "SUPABASE_URL", type: "plain_text", [key]: "CANARY_DESCRIPTOR_VALUE" }],
      });
      expect(verdict.ok, key).toBe(false);
      expect(codes(verdict.problems), key).toContain("unknown_descriptor_key");
      expect(JSON.stringify(verdict.problems), key).not.toContain("CANARY_DESCRIPTOR_VALUE");
    }
  });

  it("REJECTS a duplicate descriptor", () => {
    const verdict = validateBindingSnapshot({
      ...valid,
      bindings: [
        { name: "ASSETS", type: "assets" },
        { name: "ASSETS", type: "assets" },
      ],
    });
    expect(verdict.ok).toBe(false);
    expect(codes(verdict.problems)).toContain("duplicate_binding_name");
  });

  it("REJECTS a duplicate name carrying a DIFFERENT class", () => {
    const verdict = validateBindingSnapshot({
      ...valid,
      bindings: [
        { name: "SUPABASE_URL", type: "plain_text" },
        { name: "SUPABASE_URL", type: "secret_text" },
      ],
    });
    expect(verdict.ok).toBe(false);
    expect(codes(verdict.problems)).toContain("duplicate_binding_name");
  });

  it("REJECTS an invalid schemaVersion", () => {
    for (const schemaVersion of [0, 2, "1", null, undefined]) {
      const verdict = validateBindingSnapshot({ ...valid, schemaVersion });
      expect(verdict.ok, String(schemaVersion)).toBe(false);
      expect(codes(verdict.problems), String(schemaVersion)).toContain("invalid_schema_version");
    }
  });

  it("REJECTS an invalid Worker version UUID", () => {
    for (const workerVersionId of ["", "ae4cae19", "not-a-uuid", 12, null]) {
      const verdict = validateBindingSnapshot({ ...valid, workerVersionId });
      expect(verdict.ok, String(workerVersionId)).toBe(false);
      expect(codes(verdict.problems), String(workerVersionId)).toContain(
        "invalid_worker_version_id",
      );
    }
  });

  it("REJECTS an empty binding array, a non-array, and a null descriptor", () => {
    expect(codes(validateBindingSnapshot({ ...valid, bindings: [] }).problems)).toContain(
      "bindings_empty",
    );
    expect(codes(validateBindingSnapshot({ ...valid, bindings: {} }).problems)).toContain(
      "bindings_not_array",
    );
    expect(codes(validateBindingSnapshot({ ...valid, bindings: [null] }).problems)).toContain(
      "descriptor_not_object",
    );
    expect(
      codes(validateBindingSnapshot({ ...valid, bindings: [["ASSETS", "assets"]] }).problems),
    ).toContain("descriptor_not_object");
  });

  it("REJECTS an unbounded or non-identifier binding name, without echoing it", () => {
    const unbounded = `${"A".repeat(80)}_CANARY_LONG_NAME`;
    const verdict = validateBindingSnapshot({
      ...valid,
      bindings: [{ name: unbounded, type: "assets" }],
    });
    expect(verdict.ok).toBe(false);
    expect(codes(verdict.problems)).toContain("invalid_binding_name");
    expect(JSON.stringify(verdict.problems)).not.toContain("CANARY_LONG_NAME");
    expect(
      codes(
        validateBindingSnapshot({ ...valid, bindings: [{ name: "", type: "assets" }] }).problems,
      ),
    ).toContain("invalid_binding_name");
  });

  it("REJECTS an unsupported class", () => {
    for (const type of ["kv_namespace", "d1", "json", "text_blob", "", null]) {
      const verdict = validateBindingSnapshot({
        ...valid,
        bindings: [{ name: "SESSIONS", type }],
      });
      expect(verdict.ok, String(type)).toBe(false);
      expect(codes(verdict.problems), String(type)).toContain("unsupported_binding_class");
    }
  });

  it("REJECTS a snapshot that is not an object at all", () => {
    for (const input of ["{}", 1, null, [], undefined]) {
      expect(validateBindingSnapshot(input).ok, String(input)).toBe(false);
    }
  });

  it("every committed sanitized fixture satisfies the schema, or is a refusal fixture", () => {
    const strict = [
      "live-bindings.json",
      "candidate-preserved-bindings.json",
      "candidate-rejected-bindings.json",
      "candidate-equal-count-bindings.json",
    ];
    for (const file of strict) {
      const verdict = validateBindingSnapshot(JSON.parse(read(`${FIXTURES}/${file}`)));
      expect(verdict.problems, file).toEqual([]);
    }
    // These two exist to be REFUSED, and must stay refused.
    for (const file of ["candidate-valued-bindings.json", "snapshot-unknown-top-level-key.json"]) {
      expect(validateBindingSnapshot(JSON.parse(read(`${FIXTURES}/${file}`))).ok, file).toBe(false);
    }
  });

  it("no committed fixture carries a `_note`, which is what P2-1 was made of", () => {
    for (const file of readdirSync(resolve(process.cwd(), FIXTURES))) {
      if (!file.endsWith(".json")) continue;
      if (file === "snapshot-unknown-top-level-key.json") continue; // the refusal fixture
      expect(read(`${FIXTURES}/${file}`), file).not.toContain("_note");
    }
  });
});
