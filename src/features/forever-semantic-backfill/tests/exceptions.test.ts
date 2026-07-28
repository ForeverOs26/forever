import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  buildRoleCompletenessReport,
  evaluateReleaseGate,
} from "../../forever-direct-publish/role-completeness";
import {
  buildExceptions,
  serialiseExceptions,
  validateExceptions,
  writeExceptionsFile,
} from "../exceptions";
import { buildBackfillManifest } from "../plan";
import type { BackfillException } from "../types";
import {
  GENERATED_AT,
  GENERATOR_COMMIT,
  POLICY,
  URLS,
  snapshot,
  standardEvidence,
} from "./fixtures";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const manifest = buildBackfillManifest({
  snapshot: snapshot(),
  evidenceBySlug: standardEvidence(),
  policy: POLICY,
  generatorCommit: GENERATOR_COMMIT,
  generatedAt: GENERATED_AT,
  acknowledgements: [],
});

describe("what becomes an exception", () => {
  it("covers exactly the URLs with no proposed role", () => {
    const roleLess = manifest.projects.flatMap((project) =>
      project.urls.filter((url) => url.proposed_semantic_role === null).map((url) => url.url),
    );
    expect(manifest.exceptions.map((entry) => entry.url).sort()).toEqual([...roleLess].sort());
  });

  it("names the bundled-asset key case for what it is", () => {
    const surin = manifest.exceptions.find((entry) => entry.url === "villaSeeded")!;
    expect(surin.reasonCode).toBe("not_a_public_url_bundled_asset_key");
    expect(surin.objectIdentifier).toBe("bundled-asset-key:villaSeeded");
    expect(surin.reason).toContain("not a URL");
  });

  it("is sorted, so two runs produce the same file", () => {
    const again = buildExceptions(manifest.projects);
    expect(again.map((entry) => `${entry.projectSlug} ${entry.url}`)).toEqual(
      manifest.exceptions.map((entry) => `${entry.projectSlug} ${entry.url}`),
    );
  });

  it("carries one entry per URL, covering every governed media_type of it", () => {
    // The gate's key is (projectSlug, url) with no media_type, which is what
    // Sierra's dual-typed hero needs.
    const keys = manifest.exceptions.map((entry) => `${entry.projectSlug} ${entry.url}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the file the gate consumes", () => {
  it("is a bare array — readExceptions exits 2 on anything else", () => {
    const text = serialiseExceptions(manifest.exceptions);
    expect(text.trimStart().startsWith("[")).toBe(true);
    expect(Array.isArray(JSON.parse(text))).toBe(true);
  });

  it("is consumed unchanged by buildRoleCompletenessReport", () => {
    // No translation step, so the release evidence and the release decision
    // cannot describe two different sets of rows.
    const rows = [
      {
        projectSlug: "seeded-placeholder-villas",
        mediaType: "gallery",
        url: "villaSeeded",
        semanticRole: null,
      },
    ];
    const report = buildRoleCompletenessReport(
      rows,
      JSON.parse(serialiseExceptions(manifest.exceptions)),
    );
    expect(report.unexplained).toEqual([]);
    expect(report.excused).toHaveLength(1);
    expect(evaluateReleaseGate(report, "after_backfill").passed).toBe(true);
  });

  it("blocks the same gate when the file is not supplied", () => {
    const rows = [
      {
        projectSlug: "seeded-placeholder-villas",
        mediaType: "gallery",
        url: "villaSeeded",
        semanticRole: null,
      },
    ];
    const verdict = evaluateReleaseGate(buildRoleCompletenessReport(rows, []), "after_backfill");
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.join(" ")).toContain("villaSeeded");
  });

  it("writes to disk and refuses a private path first", () => {
    const dir = mkdtempSync(join(tmpdir(), "forever-backfill-exceptions-"));
    roots.push(dir);
    const path = join(dir, "exceptions.json");
    writeExceptionsFile(path, manifest.exceptions);
    expect(JSON.parse(readFileSync(path, "utf8"))).toHaveLength(manifest.exceptions.length);

    const leaky: BackfillException[] = [
      { ...manifest.exceptions[0], reason: "the bytes live in C:/Users/owner/Downloads" },
    ];
    expect(() => writeExceptionsFile(join(dir, "leak.json"), leaky)).toThrowError(
      /Windows filesystem path/,
    );
  });
});

describe("validateExceptions", () => {
  const base = manifest.exceptions[0];

  it("refuses a blank reason, which excuses nothing while appearing to", () => {
    expect(validateExceptions([{ ...base, reason: "  " }]).map((i) => i.code)).toContain(
      "exception_missing_reason",
    );
  });

  it("refuses an absent reason, which throws inside the gate with no diagnostic", () => {
    const broken = { ...base } as Partial<BackfillException>;
    delete broken.reason;
    expect(validateExceptions([broken as BackfillException]).map((i) => i.code)).toContain(
      "exception_missing_reason",
    );
    // Demonstrates the failure this refusal prevents.
    expect(() =>
      buildRoleCompletenessReport(
        [
          {
            projectSlug: base.projectSlug,
            mediaType: "gallery",
            url: base.url,
            semanticRole: null,
          },
        ],
        [broken as BackfillException],
      ),
    ).toThrowError(TypeError);
  });

  it("refuses a reason code outside the vocabulary", () => {
    expect(
      validateExceptions([{ ...base, reasonCode: "because_i_said_so" as never }]).map(
        (i) => i.code,
      ),
    ).toContain("exception_unknown_reason_code");
  });

  it("refuses two entries for the same (projectSlug, url)", () => {
    expect(validateExceptions([base, { ...base }]).map((i) => i.code)).toContain(
      "exception_duplicate",
    );
  });

  it("accepts the planner's own output", () => {
    expect(validateExceptions(manifest.exceptions)).toEqual([]);
  });
});

describe("expiry", () => {
  it("is recorded even though the gate cannot honour it", () => {
    // The gate has no concept of time: an expired exception excuses its row
    // forever. Recording the release here is what lets `verify` enforce it.
    expect(manifest.exceptions.every((entry) => entry.expiresAfterRelease.length > 0)).toBe(true);
    expect(manifest.exceptions.every((entry) => entry.reEvaluateWhen.length > 0)).toBe(true);
  });
});

describe("the idempotency key ties the file to the plan", () => {
  it("is stamped on every entry", () => {
    expect(
      manifest.exceptions.every(
        (entry) => entry.manifestIdempotencyKey === manifest.digests.idempotency_key,
      ),
    ).toBe(true);
    expect(URLS.seededBundleKey).toBe("villaSeeded");
  });
});
