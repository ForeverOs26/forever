import { describe, expect, it } from "vitest";

import type {
  ReadinessEvaluation,
  ReadinessProfile,
  ReadinessReport,
  ReadinessRequirement,
} from "..";
import {
  validateReadinessEvaluation,
  validateReadinessProfile,
  validateReadinessReference,
  validateReadinessReport,
  validateReadinessRequirement,
} from "..";
import { PRICE_PATH, makeProfile, makeReadinessReport } from "./fixtures";

const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

describe("requirement validation", () => {
  it("accepts every coherent statement shape", () => {
    for (const requirement of [
      { kind: "field_present", path: "a.b" },
      { kind: "field_confidence", path: "a.b", minimumConfidence: "high" },
      { kind: "field_corroborated", path: "a.b", necessity: "recommended" },
      { kind: "field_uncontested", path: "a.b", note: "why" },
      { kind: "source_present", documentType: "price_list", minimumTrust: "standard" },
      { kind: "findings_clear" },
      { kind: "findings_clear", path: "a.b" },
    ] as ReadinessRequirement[]) {
      expect(validateReadinessRequirement(requirement)).toEqual([]);
    }
  });

  it("flags absence, unknown kinds, and missing kind-essential parameters", () => {
    expect(codes(validateReadinessRequirement(undefined as never))).toEqual([
      "missing_requirement",
    ]);
    expect(codes(validateReadinessRequirement({ kind: "blessed" } as never))).toEqual([
      "unknown_requirement_kind",
    ]);
    expect(codes(validateReadinessRequirement({ kind: "field_present" }))).toContain(
      "missing_requirement_path",
    );
    expect(codes(validateReadinessRequirement({ kind: "field_confidence", path: "a" }))).toContain(
      "unknown_requirement_confidence",
    );
    expect(codes(validateReadinessRequirement({ kind: "source_present" }))).toContain(
      "unknown_requirement_document_type",
    );
    expect(
      codes(
        validateReadinessRequirement({
          kind: "source_present",
          documentType: "price_list",
          minimumTrust: "blessed" as never,
        }),
      ),
    ).toContain("unknown_requirement_trust");
    expect(codes(validateReadinessRequirement({ kind: "findings_clear", path: "" }))).toContain(
      "empty_requirement_path",
    );
  });

  it("flags parameters foreign to the kind — a described statement never carries them", () => {
    expect(
      codes(
        validateReadinessRequirement({
          kind: "field_present",
          path: "a",
          documentType: "price_list",
          minimumConfidence: "high",
          minimumTrust: "standard",
        }),
      ),
    ).toEqual([
      "extraneous_requirement_parameter",
      "extraneous_requirement_parameter",
      "extraneous_requirement_parameter",
    ]);
    expect(
      codes(
        validateReadinessRequirement({
          kind: "source_present",
          documentType: "price_list",
          path: "a",
        }),
      ),
    ).toContain("extraneous_requirement_parameter");
  });

  it("flags malformed necessity and empty notes, and never throws on hostility", () => {
    expect(
      codes(
        validateReadinessRequirement({
          kind: "field_present",
          path: "a",
          necessity: "optional" as never,
          note: "",
        }),
      ),
    ).toEqual(["unknown_requirement_necessity", "empty_requirement_note"]);
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile");
        },
      },
    ) as ReadinessRequirement;
    expect(codes(validateReadinessRequirement(hostile))).toEqual(["unvalidatable_input"]);
  });
});

describe("reference and evaluation validation", () => {
  it("a reference must point at something coherent", () => {
    expect(validateReadinessReference({ path: "a.b" })).toEqual([]);
    expect(codes(validateReadinessReference({}))).toEqual(["empty_reference"]);
    expect(codes(validateReadinessReference({ factId: "" }))).toContain("empty_reference_fact");
    expect(
      codes(validateReadinessReference({ sourceId: "s", sourceVersion: { major: 1 } as never })),
    ).toContain("malformed_reference_version");
  });

  it("an evaluation must state its judgement completely", () => {
    const evaluation: ReadinessEvaluation = {
      id: "reva_coralina-field-present-1",
      requirement: { kind: "field_present", path: PRICE_PATH, necessity: "required" },
      verdict: "met",
      reason: "stated",
      references: [{ path: PRICE_PATH }],
    };
    expect(validateReadinessEvaluation(evaluation)).toEqual([]);

    expect(codes(validateReadinessEvaluation(undefined as never))).toEqual(["missing_evaluation"]);
    expect(
      codes(
        validateReadinessEvaluation({
          ...evaluation,
          id: "",
          verdict: "approved" as never,
          reason: "",
        }),
      ),
    ).toEqual(["missing_evaluation_id", "unknown_evaluation_verdict", "missing_evaluation_reason"]);
  });

  it("an implicit necessity marks a hand-built evaluation", () => {
    const evaluation: ReadinessEvaluation = {
      id: "reva_x-field-present-1",
      requirement: { kind: "field_present", path: PRICE_PATH },
      verdict: "met",
      reason: "stated",
      references: [],
    };
    expect(codes(validateReadinessEvaluation(evaluation))).toEqual([
      "implicit_evaluation_necessity",
    ]);
  });

  it("flags malformed references, finding ids, standings, and times", () => {
    const evaluation = {
      id: "reva_x-findings-clear-1",
      requirement: { kind: "findings_clear", necessity: "required" },
      verdict: "unmet",
      reason: "stated",
      references: [{}, { path: "" }],
      findingIds: ["", "xfnd_a", "xfnd_a"],
      standing: "blessed",
      evaluatedAt: "",
    } as unknown as ReadinessEvaluation;
    expect(codes(validateReadinessEvaluation(evaluation))).toEqual([
      "empty_reference",
      "empty_reference_path",
      "empty_finding_reference",
      "duplicate_finding_reference",
      "unknown_evaluation_standing",
      "empty_evaluation_time",
    ]);
  });
});

describe("profile validation", () => {
  it("flags missing identity and restated demands", () => {
    const profile = makeProfile();
    expect(validateReadinessProfile(profile)).toEqual([]);
    expect(
      codes(
        validateReadinessProfile({
          ...profile,
          id: "",
          requirements: [
            { kind: "field_present", path: "a" },
            { kind: "field_present", path: "a", note: "again" },
          ],
        } as ReadinessProfile),
      ),
    ).toEqual(["missing_profile_id", "duplicate_requirement"]);
  });
});

describe("report validation", () => {
  it("accepts the engine's own output", () => {
    expect(validateReadinessReport(makeReadinessReport())).toEqual([]);
  });

  it("flags a standing the evaluations do not amount to", () => {
    const report = makeReadinessReport();
    const claimed = { ...report, standing: "blocked" } as ReadinessReport;
    expect(codes(validateReadinessReport(claimed))).toEqual(["inconsistent_report_standing"]);
    const invented = { ...report, standing: "approved" } as unknown as ReadinessReport;
    expect(codes(validateReadinessReport(invented))).toEqual(["unknown_report_standing"]);
  });

  it("flags duplicate evaluation ids and restated demands", () => {
    const report = makeReadinessReport();
    const duplicated: ReadinessReport = structuredClone(report);
    duplicated.evaluations.push(structuredClone(duplicated.evaluations[0]));
    const issues = codes(validateReadinessReport(duplicated));
    expect(issues).toContain("duplicate_evaluation_id");
    expect(issues).toContain("duplicate_requirement");
  });

  it("flags slots and evaluations that do not account for each other", () => {
    const report = structuredClone(makeReadinessReport());
    report.slots[0].evaluationId = "reva_coralina-unknown-9";
    const issues = codes(validateReadinessReport(report));
    expect(issues).toContain("unknown_evaluation_reference");
    expect(issues).toContain("unstated_evaluation");

    const orphaned = structuredClone(makeReadinessReport());
    orphaned.slots.pop();
    expect(codes(validateReadinessReport(orphaned))).toContain("unstated_evaluation");

    const doubled = structuredClone(makeReadinessReport());
    doubled.slots[1].evaluationId = doubled.slots[0].evaluationId;
    expect(codes(validateReadinessReport(doubled))).toEqual(
      expect.arrayContaining(["duplicate_evaluation_reference", "unstated_evaluation"]),
    );
  });

  it("flags inadmissible slots that point at evaluations or state no reason", () => {
    const report = structuredClone(makeReadinessReport());
    report.slots[0] = {
      statement: report.slots[0].statement,
      admissibility: "inadmissible",
      evaluationId: report.slots[0].evaluationId,
    };
    const issues = codes(validateReadinessReport(report));
    expect(issues).toContain("missing_slot_reason");
    expect(issues).toContain("inadmissible_slot_evaluation");
  });

  it("flags a source roster that does not mirror the evaluations", () => {
    const report = structuredClone(makeReadinessReport());
    report.sourceIds.push("psrc_coralina-unheard-of-v1-0-0");
    expect(codes(validateReadinessReport(report))).toContain("unknown_source_reference");

    const doubled = structuredClone(makeReadinessReport());
    doubled.sourceIds.push(doubled.sourceIds[0]);
    expect(codes(validateReadinessReport(doubled))).toContain("duplicate_source_reference");
  });

  it("reports hostility as one structured issue, never a throw", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile");
        },
      },
    ) as ReadinessReport;
    expect(codes(validateReadinessReport(hostile))).toEqual(["unvalidatable_input"]);
    expect(codes(validateReadinessReport(undefined as never))).toEqual(["missing_report"]);
  });
});
