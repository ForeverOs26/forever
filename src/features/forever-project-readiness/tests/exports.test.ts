import { describe, expect, it } from "vitest";

import * as readiness from "..";

/**
 * The public API pin: the one index module exposes the whole foundation. A
 * disappearing export is an API break the type system alone would not
 * surface to consumers importing through the feature root.
 */
describe("public exports", () => {
  it("exposes the vocabularies and identity helpers", () => {
    expect(readiness.READINESS_ID_PREFIXES).toBeDefined();
    expect(readiness.READINESS_REQUIREMENT_KINDS).toBeDefined();
    expect(readiness.READINESS_NECESSITIES).toBeDefined();
    expect(readiness.READINESS_VERDICTS).toBeDefined();
    expect(readiness.READINESS_STANDINGS).toBeDefined();
    expect(readiness.READINESS_SUBJECT_STANDINGS).toBeDefined();
    expect(readiness.READINESS_TRUST_LEVELS).toBeDefined();
    expect(readiness.READINESS_DOCUMENT_TYPES).toBeDefined();
    expect(readiness.readinessReportIdFor).toBeTypeOf("function");
    expect(readiness.readinessEvaluationIdFor).toBeTypeOf("function");
    expect(readiness.readinessProfileIdFor).toBeTypeOf("function");
  });

  it("exposes the models, engine, and helpers", () => {
    expect(readiness.readinessRequirement).toBeTypeOf("function");
    expect(readiness.describeReadinessProfile).toBeTypeOf("function");
    expect(readiness.describeProjectReadiness).toBeTypeOf("function");
    expect(readiness.readinessStandingFor).toBeTypeOf("function");
    expect(readiness.pickReadinessSubjectStanding).toBeTypeOf("function");
    expect(readiness.listReadinessBlockers).toBeTypeOf("function");
    expect(readiness.listReadinessAdvisories).toBeTypeOf("function");
    expect(readiness.listReadinessEvaluationsByKind).toBeTypeOf("function");
    expect(readiness.findReadinessEvaluation).toBeTypeOf("function");
    expect(readiness.createReadinessResult).toBeTypeOf("function");
    expect(readiness.readinessHistoryEntry).toBeTypeOf("function");
    expect(readiness.emptyReadinessCatalog).toBeTypeOf("function");
    expect(readiness.ReadinessRegistry).toBeTypeOf("function");
    expect(readiness.defineReadinessProvider).toBeTypeOf("function");
  });

  it("exposes the whole never-throwing validation pipeline", () => {
    expect(readiness.validateReadinessReference).toBeTypeOf("function");
    expect(readiness.validateReadinessRequirement).toBeTypeOf("function");
    expect(readiness.validateReadinessEvaluation).toBeTypeOf("function");
    expect(readiness.validateReadinessProfile).toBeTypeOf("function");
    expect(readiness.validateReadinessReport).toBeTypeOf("function");
    expect(readiness.validateReadinessHistory).toBeTypeOf("function");
    expect(readiness.validateReadinessCatalog).toBeTypeOf("function");
  });

  it("exposes the reused machinery under readiness names", () => {
    expect(readiness.readinessError).toBeTypeOf("function");
    expect(readiness.readinessWarning).toBeTypeOf("function");
    expect(readiness.partitionReadinessIssues).toBeTypeOf("function");
    expect(readiness.meetsReadinessConfidence).toBeTypeOf("function");
    expect(readiness.meetsReadinessTrust).toBeTypeOf("function");
    expect(readiness.readinessSubjectStandingForConsensus).toBeTypeOf("function");
    expect(readiness.defaultReadinessPolicy).toBeTypeOf("function");
    expect(readiness.normalizeReadinessSlug).toBeTypeOf("function");
    expect(readiness.readinessProjectId).toBeTypeOf("function");
    expect(readiness.compareReadinessStrings).toBeTypeOf("function");
    expect(readiness.mergeReadinessStats).toBeTypeOf("function");
    expect(readiness.emptyReadinessStats).toBeTypeOf("function");
  });
});
