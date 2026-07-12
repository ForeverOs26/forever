import { describe, expect, it } from "vitest";

import {
  findCrossValidationAssessment,
  listCrossValidationFindingsRequiringReview,
} from "@/features/forever-cross-validation";
import { knowledgeStandingForConsensus } from "@/features/forever-knowledge-graph";

import { listReadinessEvaluationsByKind } from "..";
import {
  PRICE_PATH,
  makeAgreeingFact,
  makeConflictingFact,
  makeFact,
  makeReport,
  runReadiness,
} from "./fixtures";

/**
 * The bridge coherence pins: the readiness gate re-expresses the RC4.7
 * examination through the RC4.8 standing mapping — it never re-judges. If
 * the gate could reach a different conclusion than the examination (or the
 * knowledge graph) over the same facts, two parts of the system would
 * disagree about the same knowledge.
 */
describe("bridge coherence with RC4.7 and RC4.8", () => {
  const subjectKeyFor = (path: string) => `proj_coralina:price:${path}`;

  it("field_corroborated is met exactly when the RC4.7 consensus is corroborated", () => {
    for (const facts of [
      [makeFact(), makeAgreeingFact()],
      [makeFact(), makeConflictingFact()],
      [makeFact()],
    ]) {
      const examination = makeReport(facts);
      const assessment = findCrossValidationAssessment(examination, subjectKeyFor(PRICE_PATH))!;
      const evaluation = listReadinessEvaluationsByKind(
        runReadiness(
          { report: examination },
          { requirements: [{ kind: "field_corroborated", path: PRICE_PATH }] },
        ).data[0],
        "field_corroborated",
      )[0];
      expect(evaluation.verdict === "met").toBe(assessment.consensus === "corroborated");
    }
  });

  it("the evaluation's standing is the reused RC4.8 mapping of the RC4.7 consensus", () => {
    for (const facts of [
      [makeFact(), makeAgreeingFact()],
      [makeFact(), makeConflictingFact()],
      [makeFact()],
    ]) {
      const examination = makeReport(facts);
      const assessment = findCrossValidationAssessment(examination, subjectKeyFor(PRICE_PATH))!;
      const evaluation = listReadinessEvaluationsByKind(
        runReadiness(
          { report: examination },
          { requirements: [{ kind: "field_corroborated", path: PRICE_PATH }] },
        ).data[0],
        "field_corroborated",
      )[0];
      expect(evaluation.standing).toBe(knowledgeStandingForConsensus(assessment.consensus));
    }
  });

  it("field_uncontested blocks exactly when the mapped standing requires review", () => {
    const contested = makeReport([makeFact(), makeConflictingFact()]);
    const evaluation = listReadinessEvaluationsByKind(
      runReadiness(
        { report: contested },
        { requirements: [{ kind: "field_uncontested", path: PRICE_PATH }] },
      ).data[0],
      "field_uncontested",
    )[0];
    expect(evaluation.verdict).toBe("unmet");
    expect(evaluation.standing).toBe("disputed");
  });

  it("findings_clear counts exactly the findings RC4.7 marks as requiring review", () => {
    const contested = makeReport([makeFact(), makeConflictingFact()]);
    const blocking = listCrossValidationFindingsRequiringReview(contested);
    const evaluation = listReadinessEvaluationsByKind(
      runReadiness({ report: contested }, { requirements: [{ kind: "findings_clear" }] }).data[0],
      "findings_clear",
    )[0];
    expect(evaluation.verdict).toBe(blocking.length === 0 ? "met" : "unmet");
    expect(evaluation.findingIds).toEqual(blocking.map((finding) => finding.id));
  });

  it("the gate traces contested judgements to the very findings the examination described", () => {
    const contested = makeReport([makeFact(), makeConflictingFact()]);
    const assessment = findCrossValidationAssessment(contested, subjectKeyFor(PRICE_PATH))!;
    const evaluation = listReadinessEvaluationsByKind(
      runReadiness(
        { report: contested },
        { requirements: [{ kind: "field_corroborated", path: PRICE_PATH }] },
      ).data[0],
      "field_corroborated",
    )[0];
    expect(evaluation.findingIds).toEqual(assessment.findingIds);
  });
});
