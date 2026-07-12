import { describe, expect, it } from "vitest";

import type { ReadinessContext, ReadinessRequest, ReadinessRequirement } from "..";
import { describeProjectReadiness, validateReadinessReport } from "..";
import {
  PRICE_PATH,
  makeContext,
  makePriceListSource,
  makeRecordWithValues,
  makeRequest,
  runReadiness,
} from "./fixtures";

describe("malformed and hostile requests", () => {
  it("an absent request or unusable slug settles into a structured failure", () => {
    for (const request of [
      undefined,
      null,
      {},
      { projectSlug: "" },
      { projectSlug: "  --  " },
    ] as unknown as ReadinessRequest[]) {
      const result = describeProjectReadiness(makeContext(), request);
      expect(result.ok).toBe(false);
      expect(result.data).toEqual([]);
      expect(result.errors[0].code).toBe("missing_readiness_project");
    }
  });

  it("a non-list requirements value fails the request", () => {
    const result = runReadiness({}, { requirements: "all" as unknown as ReadinessRequirement[] });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("invalid_readiness_requirements");
  });

  it("readiness is never presumed from silence: zero statements fail", () => {
    const result = runReadiness({}, { requirements: [] });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("missing_readiness_requirements");
  });

  it("malformed statements settle into inadmissible slots, never a throw", () => {
    const result = runReadiness(
      {},
      {
        requirements: [
          null as never,
          { kind: "field_blessed" } as never,
          { kind: "field_present" },
          { kind: "field_confidence", path: PRICE_PATH, minimumConfidence: "blessed" as never },
          { kind: "source_present" },
          { kind: "source_present", documentType: "price_list", minimumTrust: "blessed" as never },
          { kind: "findings_clear", path: "" },
          { kind: "field_present", path: PRICE_PATH },
        ],
      },
    );
    expect(result.ok).toBe(false);
    const report = result.data[0];
    expect(report.slots.filter((slot) => slot.admissibility === "inadmissible")).toHaveLength(7);
    expect(report.evaluations).toHaveLength(1);
    expect(result.stats.failed).toBe(7);
    expect(validateReadinessReport(report)).toEqual([]);
  });

  it("a hostile statement with a throwing accessor excludes that slot only", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile");
        },
      },
    ) as ReadinessRequirement;
    const result = runReadiness(
      {},
      { requirements: [hostile, { kind: "field_present", path: PRICE_PATH }] },
    );
    const report = result.data[0];
    expect(report.slots[0].admissibility).toBe("inadmissible");
    expect(report.slots[0].reason).toContain("could not be examined");
    expect(report.slots[1].admissibility).toBe("evaluated");
    expect(validateReadinessReport(report)).toEqual([]);
  });

  it("a hole in the requirements list is an inadmissible statement, never skipped", () => {
    const requirements: ReadinessRequirement[] = [];
    requirements[1] = { kind: "field_present", path: PRICE_PATH };
    const result = runReadiness({}, { requirements });
    const report = result.data[0];
    expect(report.slots[0].admissibility).toBe("inadmissible");
    expect(report.slots[1].admissibility).toBe("evaluated");
  });

  it("a wholly hostile request settles into one structured failure", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile");
        },
      },
    ) as ReadinessRequest;
    const result = describeProjectReadiness(makeContext(), hostile);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("unassessable_input");
  });
});

describe("malformed and hostile contexts", () => {
  it("a malformed clock or batch stamps and names nothing — reported, never repaired", () => {
    const result = runReadiness({ now: 42 as unknown as string }, { batch: "" });
    expect(result.ok).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["invalid_readiness_now", "invalid_readiness_batch"]),
    );
    const serialized = JSON.stringify(result.data[0]);
    expect(serialized).not.toContain("describedAt");
    expect(result.data[0].id).toBe("rrep_coralina");
  });

  it("a non-object record, foreign record, or non-list fields is set aside", () => {
    for (const [record, code] of [
      ["junk", "invalid_readiness_record"],
      [{ identity: { projectId: "proj_other" } }, "foreign_record"],
      [{ identity: { projectId: "proj_coralina" }, fields: "none" }, "invalid_record_fields"],
    ] as const) {
      const result = runReadiness(
        { record: record as unknown as ReadinessContext["record"] },
        { requirements: [{ kind: "field_present", path: PRICE_PATH }] },
      );
      expect(result.warnings.some((issue) => issue.code === code)).toBe(true);
      expect(result.data[0].evaluations[0].verdict).toBe("indeterminate");
    }
  });

  it("a non-object, foreign, or list-less examination report is set aside", () => {
    for (const [report, code] of [
      ["junk", "invalid_examination_report"],
      [{ projectId: "proj_other", subjects: [], findings: [] }, "foreign_report"],
      [
        { projectId: "proj_coralina", subjects: "none", findings: [] },
        "invalid_examination_report",
      ],
    ] as const) {
      const result = runReadiness(
        { report: report as unknown as ReadinessContext["report"] },
        { requirements: [{ kind: "findings_clear" }] },
      );
      expect(result.warnings.some((issue) => issue.code === code)).toBe(true);
      expect(result.data[0].evaluations[0].verdict).toBe("indeterminate");
    }
  });

  it("malformed, duplicate, and foreign registered sources are set aside individually", () => {
    const result = runReadiness(
      {
        sources: [
          null as never,
          makePriceListSource(),
          makePriceListSource(),
          {
            ...makePriceListSource({ sourceSlug: "price-list-2" }),
            identity: {
              ...makePriceListSource({ sourceSlug: "price-list-2" }).identity,
              projectId: "proj_other",
            },
          },
        ],
      },
      { requirements: [{ kind: "source_present", documentType: "price_list" }] },
    );
    expect(result.warnings.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "malformed_registered_source",
        "duplicate_registered_source",
        "foreign_registered_source",
      ]),
    );
    expect(result.data[0].evaluations[0].verdict).toBe("met");
  });

  it("a non-list sources value judges source statements indeterminate", () => {
    const result = runReadiness(
      { sources: "all" as unknown as ReadinessContext["sources"] },
      { requirements: [{ kind: "source_present", documentType: "price_list" }] },
    );
    expect(result.warnings.some((issue) => issue.code === "invalid_registered_sources")).toBe(true);
    expect(result.data[0].evaluations[0].verdict).toBe("indeterminate");
  });

  it("a hostile field deep inside the record settles that statement indeterminate", () => {
    const record = makeRecordWithValues([]);
    record.fields[0] = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile");
        },
      },
    ) as never;
    const result = runReadiness(
      { record },
      { requirements: [{ kind: "field_present", path: PRICE_PATH }] },
    );
    expect(result.data[0].evaluations[0].verdict).toBe("indeterminate");
    expect(result.data[0].evaluations[0].reason).toContain("could not be examined");
    expect(validateReadinessReport(result.data[0])).toEqual([]);
  });

  it("an uncloneable described report settles into a structured failure", () => {
    const source = makePriceListSource();
    (source.version as { hostile?: unknown }).hostile = () => {};
    const result = runReadiness(
      { sources: [source] },
      { requirements: [{ kind: "source_present", documentType: "price_list" }] },
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("uncloneable_report");
    expect(result.data).toEqual([]);
  });

  it("a malformed profile states nothing, and its absence is reported", () => {
    const result = runReadiness(
      {},
      {
        profile: "junk" as unknown as ReadinessRequest["profile"],
        requirements: makeRequest().requirements,
      },
    );
    expect(result.warnings.some((issue) => issue.code === "invalid_readiness_profile")).toBe(true);
    expect(result.data[0].profileId).toBeUndefined();
    expect(result.data[0].evaluations).toHaveLength(6);
  });

  it("extraneous parameters are set aside with a warning — the demand still evaluates", () => {
    const result = runReadiness(
      {},
      {
        requirements: [
          {
            kind: "field_present",
            path: PRICE_PATH,
            documentType: "price_list",
            minimumTrust: "standard",
            minimumConfidence: "high",
          },
        ],
      },
    );
    expect(
      result.warnings.filter((issue) => issue.code === "extraneous_requirement_parameter"),
    ).toHaveLength(3);
    const evaluation = result.data[0].evaluations[0];
    expect(evaluation.verdict).toBe("met");
    expect(evaluation.requirement).toEqual({
      kind: "field_present",
      path: PRICE_PATH,
      necessity: "required",
    });
    expect(validateReadinessReport(result.data[0])).toEqual([]);
  });

  it("an unknown necessity demands — warned, defaulted to required, never excused", () => {
    const result = runReadiness(
      { record: makeRecordWithValues([]) },
      {
        requirements: [{ kind: "field_present", path: PRICE_PATH, necessity: "optional" as never }],
      },
    );
    expect(result.warnings.some((issue) => issue.code === "unknown_requirement_necessity")).toBe(
      true,
    );
    expect(result.data[0].evaluations[0].requirement.necessity).toBe("required");
    expect(result.data[0].standing).toBe("blocked");
  });

  it("an empty note is set aside with a warning, never preserved as blank", () => {
    const result = runReadiness(
      {},
      { requirements: [{ kind: "field_present", path: PRICE_PATH, note: "" }] },
    );
    expect(result.warnings.some((issue) => issue.code === "invalid_requirement_note")).toBe(true);
    expect(result.data[0].evaluations[0].requirement.note).toBeUndefined();
  });
});
