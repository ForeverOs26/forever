import { describe, expect, it } from "vitest";

import {
  compareCrossValidationSourceVersionTotal,
  compareCrossValidationStrings,
  isKnownCrossSourceTrustLevel,
  isWellFormedCrossValidationSourceVersion,
  meetsCrossSourceTrust,
  meetsCrossValidationConfidence,
} from "@/features/forever-cross-validation";
import {
  compareExtractionVersion,
  formatExtractionVersion,
} from "@/features/forever-extraction-pipeline";
import {
  isKnownKnowledgeStanding,
  isSettledKnowledgeStanding,
  knowledgeStandingForConsensus,
  knowledgeStandingRequiresReview,
} from "@/features/forever-knowledge-graph";
import {
  defaultProjectDatabasePolicy,
  deriveProjectDatabaseOutcome,
  deriveProjectDatabaseState,
  emptyProjectDatabaseStats,
  isKnownProjectConfidenceLevel,
  mergeProjectDatabaseStats,
  partitionProjectDatabaseIssues,
  projectConfidence,
  projectDatabaseError,
  projectDatabaseWarning,
  sumProjectDatabaseStats,
  unknownProjectConfidence,
} from "@/features/forever-project-database";
import {
  isKnownProjectSourceDocumentType,
  meetsProjectSourceTrust,
} from "@/features/forever-project-sources";

import {
  compareReadinessSourceVersion,
  compareReadinessSourceVersionTotal,
  compareReadinessStrings,
  defaultReadinessPolicy,
  deriveReadinessOutcome,
  deriveReadinessState,
  emptyReadinessStats,
  formatReadinessSourceVersion,
  isKnownReadinessConfidenceLevel,
  isKnownReadinessDocumentType,
  isKnownReadinessSubjectStanding,
  isKnownReadinessTrustLevel,
  isSettledReadinessSubjectStanding,
  isWellFormedReadinessSourceVersion,
  meetsReadinessConfidence,
  meetsReadinessTrust,
  mergeReadinessStats,
  partitionReadinessIssues,
  readinessConfidence,
  readinessError,
  readinessSubjectStandingForConsensus,
  readinessSubjectStandingRequiresReview,
  readinessWarning,
  sumReadinessStats,
  unknownReadinessConfidence,
} from "..";

describe("reuse: RC4.9 re-exports the neighbouring machinery — the same functions", () => {
  it("reuses the RC4.6 issue and confidence machinery", () => {
    expect(readinessError).toBe(projectDatabaseError);
    expect(readinessWarning).toBe(projectDatabaseWarning);
    expect(partitionReadinessIssues).toBe(partitionProjectDatabaseIssues);
    expect(readinessConfidence).toBe(projectConfidence);
    expect(unknownReadinessConfidence).toBe(unknownProjectConfidence);
    expect(isKnownReadinessConfidenceLevel).toBe(isKnownProjectConfidenceLevel);
  });

  it("reuses the RC4.5/RC4.4/RC3.3 version machinery and the RC4.7 total guards", () => {
    expect(formatReadinessSourceVersion).toBe(formatExtractionVersion);
    expect(compareReadinessSourceVersion).toBe(compareExtractionVersion);
    expect(isWellFormedReadinessSourceVersion).toBe(isWellFormedCrossValidationSourceVersion);
    expect(compareReadinessSourceVersionTotal).toBe(compareCrossValidationSourceVersionTotal);
  });

  it("reuses the RC4.7 bar judgements, string comparison, and the RC4.4 vocabulary", () => {
    expect(meetsReadinessConfidence).toBe(meetsCrossValidationConfidence);
    expect(meetsReadinessTrust).toBe(meetsCrossSourceTrust);
    expect(meetsReadinessTrust).toBe(meetsProjectSourceTrust);
    expect(isKnownReadinessTrustLevel).toBe(isKnownCrossSourceTrustLevel);
    expect(isKnownReadinessDocumentType).toBe(isKnownProjectSourceDocumentType);
    expect(compareReadinessStrings).toBe(compareCrossValidationStrings);
  });

  it("reuses the RC4.8 standing vocabulary and its RC4.7 consensus mapping", () => {
    expect(isKnownReadinessSubjectStanding).toBe(isKnownKnowledgeStanding);
    expect(readinessSubjectStandingForConsensus).toBe(knowledgeStandingForConsensus);
    expect(isSettledReadinessSubjectStanding).toBe(isSettledKnowledgeStanding);
    expect(readinessSubjectStandingRequiresReview).toBe(knowledgeStandingRequiresReview);
  });

  it("reuses the RC4.0 lifecycle machinery and safe default policy", () => {
    expect(deriveReadinessState).toBe(deriveProjectDatabaseState);
    expect(deriveReadinessOutcome).toBe(deriveProjectDatabaseOutcome);
    expect(emptyReadinessStats).toBe(emptyProjectDatabaseStats);
    expect(mergeReadinessStats).toBe(mergeProjectDatabaseStats);
    expect(sumReadinessStats).toBe(sumProjectDatabaseStats);
    expect(defaultReadinessPolicy).toBe(defaultProjectDatabasePolicy);
  });
});
