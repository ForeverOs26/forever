import { describe, expect, it } from "vitest";

import type { CrossFactStanding, CrossSourceReading, CrossValidationFinding } from "..";
import {
  crossValidationFinding,
  partitionCrossValidationIssues,
  validateCrossFactStanding,
  validateCrossSourceReading,
  validateCrossValidationAssessment,
  validateCrossValidationCatalog,
  validateCrossValidationCatalogEntry,
  validateCrossValidationFinding,
  validateCrossValidationHistory,
  validateCrossValidationHistoryEntry,
  validateCrossValidationReport,
  validateCrossValidationRequirements,
  crossValidationHistoryEntry,
  emptyCrossValidationHistory,
  appendCrossValidationHistory,
} from "..";
import { makeFact, makeReport, makeSources, runValidation } from "./fixtures";
import { describeCrossSourceReading } from "../reading";

const codesOf = (issues: { code: string }[]) => issues.map((issue) => issue.code);

describe("validateCrossSourceReading", () => {
  it("accepts a described reading", () => {
    const reading = describeCrossSourceReading(makeFact(), { sources: makeSources() });
    expect(validateCrossSourceReading(reading)).toEqual([]);
  });

  it("reports missing references, malformed revisions, and incoherent grades", () => {
    const reading = describeCrossSourceReading(makeFact(), { sources: makeSources() });
    const broken: CrossSourceReading = {
      ...reading,
      factId: "",
      sourceId: "",
      sourceVersion: { major: "1" } as never,
      signature: undefined as never,
      confidence: { level: "sure" } as never,
      current: "yes" as never,
      registered: "no" as never,
    };
    const codes = codesOf(validateCrossSourceReading(broken));
    expect(codes).toContain("missing_reading_fact");
    expect(codes).toContain("missing_reading_source");
    expect(codes).toContain("invalid_reading_version");
    expect(codes).toContain("missing_reading_signature");
    expect(codes).toContain("unknown_confidence_level");
    expect(codes).toContain("invalid_reading_current");
    expect(codes).toContain("invalid_reading_registered");
  });

  it("reports fabricated attributions on unregistered readings", () => {
    const reading = describeCrossSourceReading(makeFact(), { sources: makeSources() });
    const fabricated: CrossSourceReading = { ...reading, registered: false };
    const codes = codesOf(validateCrossSourceReading(fabricated));
    expect(codes).toContain("fabricated_reading_authority");
    expect(codes).toContain("fabricated_reading_status");
  });
});

describe("validateCrossValidationFinding", () => {
  it("accepts every finding a described report carries", () => {
    for (const finding of makeReport().findings) {
      expect(validateCrossValidationFinding(finding)).toEqual([]);
    }
  });

  it("enforces the traceability mandate and kind coherence", () => {
    const untraceable = crossValidationFinding("x", "conflict", "requires_review", "p", "m");
    expect(codesOf(validateCrossValidationFinding(untraceable))).toContain("untraceable_finding");

    const dimensionless = crossValidationFinding(
      "x",
      "inconsistency",
      "requires_review",
      "p",
      "m",
      {
        references: [{ factId: "f" }],
      },
    );
    expect(codesOf(validateCrossValidationFinding(dimensionless))).toContain(
      "inconsistency_without_dimension",
    );

    const pathless = crossValidationFinding(
      "x",
      "missing_information",
      "requires_review",
      "p",
      "m",
      {
        references: [{ path: "a.b" }],
      },
    );
    expect(codesOf(validateCrossValidationFinding(pathless))).toContain(
      "missing_information_without_path",
    );

    const empty = crossValidationFinding("", "nope" as never, "maybe" as never, "", "", {
      references: [{}],
    });
    const codes = codesOf(validateCrossValidationFinding(empty));
    expect(codes).toContain("missing_finding_id");
    expect(codes).toContain("unknown_finding_kind");
    expect(codes).toContain("unknown_finding_disposition");
    expect(codes).toContain("missing_finding_project");
    expect(codes).toContain("missing_finding_message");
    expect(codes).toContain("empty_finding_reference");
  });
});

describe("validateCrossValidationAssessment", () => {
  it("accepts every assessment a described report carries", () => {
    for (const assessment of makeReport().subjects) {
      expect(validateCrossValidationAssessment(assessment)).toEqual([]);
    }
  });

  it("reports drifted keys, duplicate readings, and impossible consensus", () => {
    const assessment = makeReport().subjects[0];
    const drifted = { ...assessment, subject: { ...assessment.subject, key: "wrong" } };
    expect(codesOf(validateCrossValidationAssessment(drifted))).toContain("incoherent_subject_key");

    const doubled = { ...assessment, readings: [assessment.readings[0], assessment.readings[0]] };
    expect(codesOf(validateCrossValidationAssessment(doubled))).toContain("duplicate_reading_fact");

    const unaddressed = { ...assessment, consensus: "unaddressed" as const };
    expect(codesOf(validateCrossValidationAssessment(unaddressed))).toContain(
      "incoherent_consensus",
    );
    const corroboratedAlone = {
      ...assessment,
      readings: [assessment.readings[0]],
      consensus: "corroborated" as const,
    };
    expect(codesOf(validateCrossValidationAssessment(corroboratedAlone))).toContain(
      "incoherent_consensus",
    );
    const contestedEmpty = { ...assessment, readings: [], consensus: "contested" as const };
    expect(codesOf(validateCrossValidationAssessment(contestedEmpty))).toContain(
      "incoherent_consensus",
    );
  });
});

describe("validateCrossFactStanding", () => {
  it("accepts every standing a described report carries", () => {
    for (const standing of makeReport().standings) {
      expect(validateCrossFactStanding(standing)).toEqual([]);
    }
  });

  it("reports unjustified reviews and unexplained inadmissibility", () => {
    const unjustified: CrossFactStanding = {
      factId: "xfact_a",
      admissibility: "requires_review",
      findingIds: [],
    };
    expect(codesOf(validateCrossFactStanding(unjustified))).toContain("unjustified_review");

    const unexplained: CrossFactStanding = {
      factId: "",
      admissibility: "inadmissible",
      findingIds: [],
    };
    const issues = validateCrossFactStanding(unexplained);
    const { errors, warnings } = partitionCrossValidationIssues(issues);
    expect(errors).toEqual([]);
    expect(codesOf(warnings)).toContain("inadmissible_without_reason");

    const nameless: CrossFactStanding = {
      factId: "",
      admissibility: "admissible",
      findingIds: [],
    };
    expect(codesOf(validateCrossFactStanding(nameless))).toContain("missing_standing_fact");
  });
});

describe("validateCrossValidationReport", () => {
  it("accepts a described report end to end", () => {
    expect(validateCrossValidationReport(makeReport())).toEqual([]);
    const contested = runValidation(
      {},
      { facts: [makeFact(), makeFact({ factSlug: "b", rawValue: "other" })] },
    ).data[0];
    expect(validateCrossValidationReport(contested)).toEqual([]);
  });

  it("reports duplicate keys and ids, foreign findings, and dangling references", () => {
    const report = makeReport();
    const finding = report.findings[0];
    const twisted = {
      ...report,
      subjects: [...report.subjects, report.subjects[0]],
      findings: [
        ...report.findings,
        { ...finding, id: finding.id, projectId: "proj_other", subjectKey: "proj_x:ghost" },
      ],
      standings: [
        ...report.standings,
        { factId: "xfact_ghost", admissibility: "requires_review", findingIds: ["xfnd_ghost"] },
      ] as CrossFactStanding[],
    };
    const codes = codesOf(validateCrossValidationReport(twisted));
    expect(codes).toContain("duplicate_subject_key");
    expect(codes).toContain("duplicate_finding_id");
    expect(codes).toContain("foreign_finding");
    expect(codes).toContain("unanchored_finding");
    expect(codes).toContain("unknown_finding_reference");
  });

  it("reports standings whose review nothing justifies", () => {
    const report = makeReport();
    const agreement = report.findings.find((finding) => finding.kind === "agreement");
    const twisted = {
      ...report,
      standings: report.standings.map((standing, index) =>
        index === 0
          ? { ...standing, admissibility: "requires_review" as const, findingIds: [agreement!.id] }
          : standing,
      ),
    };
    expect(codesOf(validateCrossValidationReport(twisted))).toContain("unjustified_review");
  });
});

describe("validateCrossValidationRequirements", () => {
  it("accepts absence and coherent bars, and reports incoherent ones", () => {
    expect(validateCrossValidationRequirements(undefined)).toEqual([]);
    expect(
      validateCrossValidationRequirements({
        minimumTrust: "high",
        minimumConfidence: "medium",
        requireIndependentCorroboration: true,
        requireLocatedEvidence: false,
        expectedPaths: ["pricing.basePrice"],
      }),
    ).toEqual([]);
    const codes = codesOf(
      validateCrossValidationRequirements({
        minimumTrust: "absolute" as never,
        minimumConfidence: "sure" as never,
        requireIndependentCorroboration: "yes" as never,
        requireLocatedEvidence: 1 as never,
        expectedPaths: ["", 4 as never],
      }),
    );
    expect(codes).toContain("unknown_required_trust");
    expect(codes).toContain("unknown_required_confidence");
    expect(codes).toContain("invalid_corroboration_requirement");
    expect(codes).toContain("invalid_evidence_requirement");
    expect(codes.filter((code) => code === "invalid_expected_path")).toHaveLength(2);
  });
});

describe("history and catalogue validation", () => {
  it("accepts derived history entries and reports incoherent ones", () => {
    const entry = crossValidationHistoryEntry(runValidation(), {
      startedAt: "2026-07-12T00:00:00.000Z",
      finishedAt: "2026-07-12T00:00:01.000Z",
    });
    expect(validateCrossValidationHistoryEntry(entry)).toEqual([]);
    const history = appendCrossValidationHistory(
      emptyCrossValidationHistory("proj_coralina"),
      entry,
    );
    expect(validateCrossValidationHistory(history)).toEqual([]);

    const foreign = appendCrossValidationHistory(emptyCrossValidationHistory("proj_other"), entry);
    expect(codesOf(validateCrossValidationHistory(foreign))).toContain("history_project_mismatch");
    expect(
      codesOf(
        validateCrossValidationHistoryEntry({
          ...entry,
          projectId: "",
          state: "done" as never,
          reportId: "",
          startedAt: "" as never,
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        "missing_history_project",
        "unknown_history_state",
        "empty_report_reference",
        "empty_history_time",
      ]),
    );
  });

  it("accepts catalogues and reports duplicate report registrations", () => {
    const entry = { report: makeReport(), enabled: true };
    expect(validateCrossValidationCatalogEntry(entry)).toEqual([]);
    const catalog = { id: "forever-cross-validation", entries: [entry, entry] };
    expect(codesOf(validateCrossValidationCatalog(catalog))).toContain("duplicate_report_id");
  });
});

describe("issue partitioning", () => {
  it("partitions by the reused severity rule", () => {
    const issues = validateCrossValidationFinding(undefined as never);
    const { errors, warnings } = partitionCrossValidationIssues(issues);
    expect(errors.length + warnings.length).toBe(issues.length);
  });
});
