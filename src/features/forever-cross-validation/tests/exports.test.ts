import { describe, expect, it } from "vitest";

import * as crossValidation from "..";

/** The public API RC4.7 commits to. */
const EXPECTED_EXPORTS = [
  // types (reuse hub)
  "crossValidationError",
  "crossValidationWarning",
  "partitionCrossValidationIssues",
  "crossValidationConfidence",
  "unknownCrossValidationConfidence",
  "isKnownCrossValidationConfidenceLevel",
  "isCrossValidationStructuredValue",
  // version
  "formatCrossValidationSourceVersion",
  "compareCrossValidationSourceVersion",
  "compareCrossValidationSourceVersionTotal",
  "latestCrossValidationSourceVersion",
  "isWellFormedCrossValidationSourceVersion",
  // identity
  "CROSS_VALIDATION_ID_PREFIXES",
  "normalizeCrossValidationSlug",
  "crossValidationProjectId",
  "crossValidationReportIdFor",
  "crossValidationFindingIdFor",
  // subject
  "crossValidationFactSubjectKey",
  "groupCrossValidationFactsBySubject",
  "crossValidationSubjectFor",
  "crossValidationExpectedSubjectFor",
  // authority
  "CROSS_SOURCE_TRUST_LEVELS",
  "crossSourceTrustRank",
  "meetsCrossSourceTrust",
  "compareCrossSourceTrust",
  "isKnownCrossSourceTrustLevel",
  "compareCrossSourceAuthority",
  "isKnownCrossSourceAuthorityKind",
  "resolveCrossValidationSource",
  "resolveCrossSourceAuthority",
  "areIndependentCrossSources",
  // reading
  "CROSS_READING_UNDESCRIBABLE_SIGNATURE",
  "crossSourceReadingSignature",
  "crossSourceReadingCurrency",
  "describeCrossSourceReading",
  "sortCrossSourceReadings",
  // finding
  "CROSS_VALIDATION_FINDING_KINDS",
  "CROSS_VALIDATION_DISPOSITIONS",
  "CROSS_VALIDATION_DIMENSIONS",
  "isKnownCrossValidationFindingKind",
  "isKnownCrossValidationDisposition",
  "isKnownCrossValidationDimension",
  "crossValidationFindingKindRank",
  "crossValidationDimensionForFactType",
  "crossValidationFinding",
  "crossValidationFindingRequiresReview",
  "compareCrossValidationFindings",
  "sortCrossValidationFindings",
  // assessment
  "CROSS_VALIDATION_CONSENSUSES",
  "isKnownCrossValidationConsensus",
  "listCurrentCrossSourceReadings",
  "distinctCrossReadingSources",
  "distinctCrossReadingSignatures",
  "judgeCrossValidationConsensus",
  // standing
  "CROSS_FACT_ADMISSIBILITIES",
  "isKnownCrossFactAdmissibility",
  "listCrossFactStandings",
  // requirements
  "meetsCrossValidationConfidence",
  "defaultCrossValidationRequirements",
  // policy
  "defaultCrossValidationPolicy",
  // result
  "CROSS_VALIDATION_STATES",
  "CROSS_VALIDATION_TERMINAL_STATES",
  "isTerminalCrossValidationState",
  "isKnownCrossValidationState",
  "isSuccessfulCrossValidationOutcome",
  "deriveCrossValidationState",
  "deriveCrossValidationOutcome",
  "emptyCrossValidationStats",
  "createCrossValidationResult",
  // report (engine)
  "describeCrossSourceValidation",
  "listCrossValidationFindingsByKind",
  "listCrossValidationFindingsRequiringReview",
  "findCrossValidationAssessment",
  // history
  "emptyCrossValidationHistory",
  "appendCrossValidationHistory",
  "latestCrossValidationHistoryEntry",
  "crossValidationHistoryEntry",
  // catalog
  "emptyCrossValidationCatalog",
  "addCrossValidationCatalogEntry",
  "findCrossValidationCatalogEntry",
  "listEnabledCrossValidationCatalogEntries",
  "listCrossValidationCatalogEntriesForProject",
  // registry
  "CrossValidationRegistry",
  // helpers
  "isAbsent",
  "isNonEmptyString",
  "mergeCrossValidationStats",
  "sumCrossValidationStats",
  "compareCrossValidationStrings",
  "distinctCrossSourceRefs",
  // contracts
  "defineCrossValidationProvider",
  "crossValidationProviderProjectId",
  "crossValidationProviderFindingCount",
  "crossValidationProviderSubjectCount",
  "crossValidationProviderRequiresReview",
  // validation
  "validateCrossSourceReading",
  "validateCrossValidationFinding",
  "validateCrossValidationAssessment",
  "validateCrossFactStanding",
  "validateCrossValidationReport",
  "validateCrossValidationRequirements",
  "validateCrossValidationHistoryEntry",
  "validateCrossValidationHistory",
  "validateCrossValidationCatalogEntry",
  "validateCrossValidationCatalog",
] as const;

describe("public API", () => {
  it("exports the committed API surface", () => {
    for (const name of EXPECTED_EXPORTS) {
      expect(crossValidation, name).toHaveProperty(name);
    }
  });

  it("keeps the closed vocabularies stable", () => {
    expect(crossValidation.CROSS_VALIDATION_FINDING_KINDS).toEqual([
      "agreement",
      "single_source",
      "conflict",
      "inconsistency",
      "stale_revision",
      "duplicate_fact",
      "unregistered_source",
      "inactive_source",
      "authority_below_bar",
      "confidence_below_bar",
      "evidence_gap",
      "provenance_gap",
      "unsupported_claim",
      "missing_information",
    ]);
    expect(crossValidation.CROSS_VALIDATION_DISPOSITIONS).toEqual([
      "informational",
      "advisory",
      "requires_review",
    ]);
    expect(crossValidation.CROSS_VALIDATION_CONSENSUSES).toEqual([
      "corroborated",
      "uncorroborated",
      "contested",
      "incomparable",
      "unaddressed",
    ]);
    expect(crossValidation.CROSS_FACT_ADMISSIBILITIES).toEqual([
      "admissible",
      "requires_review",
      "inadmissible",
    ]);
    expect(crossValidation.CROSS_VALIDATION_DIMENSIONS).toEqual([
      "value",
      "unit",
      "currency",
      "date",
      "area",
      "price",
      "identity",
      "reference",
      "language",
    ]);
  });
});
