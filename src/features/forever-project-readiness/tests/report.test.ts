import { describe, expect, it } from "vitest";

import { projectFieldValue } from "@/features/forever-project-database";

import {
  findReadinessEvaluation,
  listReadinessAdvisories,
  listReadinessBlockers,
  listReadinessEvaluationsByKind,
  readinessReportIsBlocked,
  readinessReportIsReady,
} from "..";
import {
  BROCHURE_ID,
  PRICE_LIST_ID,
  PRICE_PATH,
  makeBrochureSource,
  makeConflictingFact,
  makeFact,
  makePriceListSource,
  makeProfile,
  makeReadinessReport,
  makeRecordWithValues,
  makeReport,
  runReadiness,
} from "./fixtures";

describe("engine: the default intake bar is met", () => {
  it("meets every default statement and stands ready", () => {
    const result = runReadiness();
    expect(result.ok).toBe(true);
    const report = result.data[0];
    expect(report.id).toBe("rrep_coralina");
    expect(report.projectId).toBe("proj_coralina");
    expect(report.standing).toBe("ready");
    expect(report.evaluations.map((evaluation) => evaluation.verdict)).toEqual([
      "met",
      "met",
      "met",
      "met",
      "met",
      "met",
    ]);
    expect(readinessReportIsReady(report)).toBe(true);
    expect(readinessReportIsBlocked(report)).toBe(false);
    expect(listReadinessBlockers(report)).toEqual([]);
  });

  it("accounts for every stated slot and pins each to its evaluation", () => {
    const report = makeReadinessReport();
    expect(report.slots).toHaveLength(6);
    expect(report.slots.every((slot) => slot.admissibility === "evaluated")).toBe(true);
    for (const slot of report.slots) {
      expect(findReadinessEvaluation(report, slot.evaluationId!)).toBeDefined();
    }
  });

  it("traces the sources it consulted, first-seen, and stamps the caller clock", () => {
    const report = makeReadinessReport();
    expect(report.sourceIds).toContain(PRICE_LIST_ID);
    expect(report.describedAt).toBe("2026-07-12T00:00:00.000Z");
    for (const evaluation of report.evaluations) {
      expect(evaluation.evaluatedAt).toBe("2026-07-12T00:00:00.000Z");
    }
  });

  it("reports headline counters that match the evaluations", () => {
    const result = runReadiness();
    expect(result.metadata).toMatchObject({
      reportId: "rrep_coralina",
      projectId: "proj_coralina",
      requirementCount: 6,
      evaluationCount: 6,
      metCount: 6,
      unmetCount: 0,
      indeterminateCount: 0,
      blockerCount: 0,
    });
    expect(result.stats.steps).toBe(6);
    expect(result.stats.completed).toBe(6);
    expect(result.state).toBe("succeeded");
  });
});

describe("engine: field_present", () => {
  it("is indeterminate without a record — presence is never judged from silence", () => {
    const result = runReadiness(
      { record: undefined },
      { requirements: [{ kind: "field_present", path: PRICE_PATH }] },
    );
    const report = result.data[0];
    expect(report.evaluations[0].verdict).toBe("indeterminate");
    expect(report.evaluations[0].references).toEqual([]);
    expect(report.standing).toBe("indeterminate");
    expect(result.warnings.some((issue) => issue.code === "undetermined_requirements")).toBe(true);
  });

  it("is unmet when the record carries no field at the path", () => {
    const report = runReadiness(
      {},
      { requirements: [{ kind: "field_present", path: "legal.ownership" }] },
    ).data[0];
    expect(report.evaluations[0].verdict).toBe("unmet");
    expect(report.evaluations[0].reason).toContain("no field");
    expect(report.standing).toBe("blocked");
  });

  it("distinguishes a stated absence from plain silence", () => {
    const stated = runReadiness(
      { record: makeRecordWithValues([projectFieldValue("missing")]) },
      { requirements: [{ kind: "field_present", path: PRICE_PATH }] },
    ).data[0];
    expect(stated.evaluations[0].verdict).toBe("unmet");
    expect(stated.evaluations[0].reason).toContain("missing by statement");

    const silent = runReadiness(
      { record: makeRecordWithValues([]) },
      { requirements: [{ kind: "field_present", path: PRICE_PATH }] },
    ).data[0];
    expect(silent.evaluations[0].verdict).toBe("unmet");
    expect(silent.evaluations[0].reason).toContain("no current entry");
  });

  it("traces a met statement to the standing value's fact and sources", () => {
    const evaluation = makeReadinessReport().evaluations.find(
      (entry) => entry.requirement.kind === "field_present",
    )!;
    expect(evaluation.references.some((reference) => reference.path === PRICE_PATH)).toBe(true);
    expect(evaluation.references.some((reference) => reference.factId !== undefined)).toBe(true);
    expect(evaluation.references.some((reference) => reference.sourceId === PRICE_LIST_ID)).toBe(
      true,
    );
  });
});

describe("engine: field_confidence", () => {
  it("grades the standing value against the stated rung through the reused ladder", () => {
    const low = makeRecordWithValues([
      projectFieldValue("current", { confidence: { level: "low", score: 0.3 } }),
    ]);
    const report = runReadiness(
      { record: low },
      { requirements: [{ kind: "field_confidence", path: PRICE_PATH, minimumConfidence: "high" }] },
    ).data[0];
    expect(report.evaluations[0].verdict).toBe("unmet");
    expect(report.evaluations[0].reason).toContain('"low" confidence, below the required "high"');
    expect(report.standing).toBe("blocked");
  });

  it("reads an out-of-vocabulary grade as the explicit unknown, which clears no bar", () => {
    const hostile = makeRecordWithValues([
      projectFieldValue("current", {
        confidence: { level: "blessed" as never, score: 1 },
      }),
    ]);
    const report = runReadiness(
      { record: hostile },
      {
        requirements: [{ kind: "field_confidence", path: PRICE_PATH, minimumConfidence: "medium" }],
      },
    ).data[0];
    expect(report.evaluations[0].verdict).toBe("unmet");
    expect(report.evaluations[0].reason).toContain('"unknown" confidence');
  });

  it("is unmet with nothing standing to grade, and indeterminate without a record", () => {
    const empty = runReadiness(
      { record: makeRecordWithValues([]) },
      {
        requirements: [{ kind: "field_confidence", path: PRICE_PATH, minimumConfidence: "medium" }],
      },
    ).data[0];
    expect(empty.evaluations[0].verdict).toBe("unmet");
    expect(empty.evaluations[0].reason).toContain("nothing to grade");

    const absent = runReadiness(
      { record: undefined },
      {
        requirements: [{ kind: "field_confidence", path: PRICE_PATH, minimumConfidence: "medium" }],
      },
    ).data[0];
    expect(absent.evaluations[0].verdict).toBe("indeterminate");
  });
});

describe("engine: field_corroborated and field_uncontested", () => {
  it("meets both when independent sources agree — the reused RC4.7 judgement", () => {
    const report = makeReadinessReport();
    const corroborated = listReadinessEvaluationsByKind(report, "field_corroborated")[0];
    expect(corroborated.verdict).toBe("met");
    expect(corroborated.standing).toBe("corroborated");
    const uncontested = listReadinessEvaluationsByKind(report, "field_uncontested")[0];
    expect(uncontested.verdict).toBe("met");
  });

  it("a contested subject blocks both, with every side preserved in the references", () => {
    const facts = [makeFact(), makeConflictingFact()];
    const report = runReadiness({ report: makeReport(facts) }).data[0];
    const corroborated = listReadinessEvaluationsByKind(report, "field_corroborated")[0];
    expect(corroborated.verdict).toBe("unmet");
    expect(corroborated.standing).toBe("disputed");
    expect(corroborated.reason).toContain("none is chosen");
    expect(
      corroborated.references.filter((reference) => reference.factId !== undefined).length,
    ).toBeGreaterThanOrEqual(2);
    expect(corroborated.findingIds!.length).toBeGreaterThan(0);

    const uncontested = listReadinessEvaluationsByKind(report, "field_uncontested")[0];
    expect(uncontested.verdict).toBe("unmet");
    expect(uncontested.standing).toBe("disputed");
    expect(report.standing).toBe("blocked");
  });

  it("a single-source reading is not corroborated but is uncontested", () => {
    const facts = [makeFact()];
    const report = runReadiness(
      { report: makeReport(facts) },
      {
        requirements: [
          { kind: "field_corroborated", path: PRICE_PATH },
          { kind: "field_uncontested", path: PRICE_PATH },
        ],
      },
    ).data[0];
    const corroborated = listReadinessEvaluationsByKind(report, "field_corroborated")[0];
    expect(corroborated.verdict).toBe("unmet");
    expect(corroborated.standing).toBe("unverified");
    const uncontested = listReadinessEvaluationsByKind(report, "field_uncontested")[0];
    expect(uncontested.verdict).toBe("met");
  });

  it("an unaddressed path is unmet for corroboration and met for contest — stated as such", () => {
    const report = runReadiness(
      {},
      {
        requirements: [
          { kind: "field_corroborated", path: "legal.ownership" },
          { kind: "field_uncontested", path: "legal.ownership" },
        ],
      },
    ).data[0];
    const corroborated = listReadinessEvaluationsByKind(report, "field_corroborated")[0];
    expect(corroborated.verdict).toBe("unmet");
    expect(corroborated.reason).toContain("addressed no reading");
    const uncontested = listReadinessEvaluationsByKind(report, "field_uncontested")[0];
    expect(uncontested.verdict).toBe("met");
    expect(uncontested.reason).toContain("nothing it judged contests it");
  });

  it("is indeterminate without an examination report", () => {
    const report = runReadiness(
      { report: undefined },
      {
        requirements: [
          { kind: "field_corroborated", path: PRICE_PATH },
          { kind: "field_uncontested", path: PRICE_PATH },
        ],
      },
    ).data[0];
    expect(report.evaluations.map((evaluation) => evaluation.verdict)).toEqual([
      "indeterminate",
      "indeterminate",
    ]);
    expect(report.standing).toBe("indeterminate");
  });
});

describe("engine: source_present", () => {
  it("is indeterminate without a source roster", () => {
    const report = runReadiness(
      { sources: undefined },
      { requirements: [{ kind: "source_present", documentType: "price_list" }] },
    ).data[0];
    expect(report.evaluations[0].verdict).toBe("indeterminate");
  });

  it("is unmet when no source of the stated type exists", () => {
    const report = runReadiness(
      { sources: [makeBrochureSource()] },
      { requirements: [{ kind: "source_present", documentType: "price_list" }] },
    ).data[0];
    expect(report.evaluations[0].verdict).toBe("unmet");
    expect(report.evaluations[0].reason).toContain("No registered source of type");
  });

  it("is unmet when every source of the type stands terminal", () => {
    const report = runReadiness(
      { sources: [makePriceListSource({ status: "superseded" })] },
      { requirements: [{ kind: "source_present", documentType: "price_list" }] },
    ).data[0];
    expect(report.evaluations[0].verdict).toBe("unmet");
    expect(report.evaluations[0].reason).toContain("none is current");
    expect(report.evaluations[0].references[0].sourceId).toBe(PRICE_LIST_ID);
  });

  it("applies a stated trust bar through the reused RC3.3 ladder — and only a stated one", () => {
    const unbarred = runReadiness(
      { sources: [makeBrochureSource()] },
      { requirements: [{ kind: "source_present", documentType: "brochure" }] },
    ).data[0];
    expect(unbarred.evaluations[0].verdict).toBe("met");

    const barred = runReadiness(
      { sources: [makeBrochureSource()] },
      {
        requirements: [
          { kind: "source_present", documentType: "brochure", minimumTrust: "authoritative" },
        ],
      },
    ).data[0];
    expect(barred.evaluations[0].verdict).toBe("unmet");
    expect(barred.evaluations[0].reason).toContain('"authoritative" trust');
    expect(barred.evaluations[0].references[0].sourceId).toBe(BROCHURE_ID);
  });

  it("traces a met statement to the qualifying documents and their pinned revisions", () => {
    const evaluation = listReadinessEvaluationsByKind(makeReadinessReport(), "source_present")[0];
    expect(evaluation.verdict).toBe("met");
    expect(evaluation.references[0]).toEqual({
      sourceId: PRICE_LIST_ID,
      sourceVersion: { major: 1, minor: 0, patch: 0 },
    });
  });
});

describe("engine: findings_clear", () => {
  it("meets a scoped statement when nothing requiring review stands at the path", () => {
    const evaluation = listReadinessEvaluationsByKind(makeReadinessReport(), "findings_clear")[0];
    expect(evaluation.verdict).toBe("met");
    expect(evaluation.references).toEqual([{ path: PRICE_PATH }]);
  });

  it("an unscoped statement addresses the whole examination", () => {
    const facts = [makeFact(), makeConflictingFact()];
    const report = runReadiness(
      { report: makeReport(facts) },
      { requirements: [{ kind: "findings_clear" }] },
    ).data[0];
    expect(report.evaluations[0].verdict).toBe("unmet");
    expect(report.evaluations[0].reason).toContain("never waived");
    expect(report.evaluations[0].findingIds!.length).toBeGreaterThan(0);
  });

  it("a scoped statement sets findings at other paths aside", () => {
    const conflictingDeveloper = [
      makeFact({
        factSlug: "dev-a",
        factType: "developer",
        fieldPath: "developer.name",
        rawValue: "A",
        structuredValue: "A",
      }),
      makeFact({
        factSlug: "dev-b",
        factType: "developer",
        fieldPath: "developer.name",
        sourceId: BROCHURE_ID,
        rawValue: "B",
        structuredValue: "B",
      }),
    ];
    const report = runReadiness(
      { report: makeReport(conflictingDeveloper) },
      { requirements: [{ kind: "findings_clear", path: PRICE_PATH }] },
    ).data[0];
    expect(report.evaluations[0].verdict).toBe("met");
  });

  it("is indeterminate without an examination report", () => {
    const report = runReadiness(
      { report: undefined },
      { requirements: [{ kind: "findings_clear" }] },
    ).data[0];
    expect(report.evaluations[0].verdict).toBe("indeterminate");
  });
});

describe("engine: necessity, profiles, and batches", () => {
  it("a recommended statement advises without blocking", () => {
    const facts = [makeFact(), makeConflictingFact()];
    const result = runReadiness(
      { report: makeReport(facts) },
      {
        requirements: [
          { kind: "field_present", path: PRICE_PATH },
          { kind: "findings_clear", necessity: "recommended" },
        ],
      },
    );
    const report = result.data[0];
    expect(report.standing).toBe("ready");
    expect(listReadinessBlockers(report)).toEqual([]);
    expect(listReadinessAdvisories(report)).toHaveLength(1);
    expect(result.warnings.some((issue) => issue.code === "unmet_recommendations")).toBe(true);
  });

  it("evaluates a profile's statements and pins the profile", () => {
    const result = runReadiness({}, { requirements: undefined, profile: makeProfile() });
    const report = result.data[0];
    expect(report.profileId).toBe("rprf_minimum-intake");
    expect(report.standing).toBe("ready");
    expect(report.slots.map((slot) => slot.statement)).toEqual([
      "profile.requirements.0",
      "profile.requirements.1",
      "profile.requirements.2",
      "profile.requirements.3",
      "profile.requirements.4",
      "profile.requirements.5",
    ]);
  });

  it("evaluates profile statements before inline ones, and dedups across both", () => {
    const result = runReadiness(
      {},
      {
        profile: makeProfile({ requirements: [{ kind: "field_present", path: PRICE_PATH }] }),
        requirements: [{ kind: "field_present", path: PRICE_PATH }],
      },
    );
    const report = result.data[0];
    expect(report.slots[0]).toMatchObject({
      statement: "profile.requirements.0",
      admissibility: "evaluated",
    });
    expect(report.slots[1]).toMatchObject({
      statement: "requirements.0",
      admissibility: "inadmissible",
    });
    expect(report.slots[1].reason).toContain("already stated");
    expect(result.ok).toBe(false);
  });

  it("the batch participates in the report id only when stated", () => {
    const report = runReadiness({}, { batch: "2026-07" }).data[0];
    expect(report.id).toBe("rrep_coralina-2026-07");
    expect(report.batch).toBe("2026-07");
  });

  it("restating one demand with a different necessity is two distinct statements", () => {
    const report = runReadiness(
      {},
      {
        requirements: [
          { kind: "field_present", path: PRICE_PATH },
          { kind: "field_present", path: PRICE_PATH, necessity: "recommended" },
        ],
      },
    ).data[0];
    expect(report.evaluations).toHaveLength(2);
    expect(report.slots.every((slot) => slot.admissibility === "evaluated")).toBe(true);
  });
});
