import { describe, expect, it } from "vitest";

import {
  compareCrossValidationSourceVersionTotal,
  compareCrossValidationStrings,
  crossSourceReadingSignature,
  isWellFormedCrossValidationSourceVersion,
} from "@/features/forever-cross-validation";
import {
  compareExtractionVersion,
  formatExtractionVersion,
} from "@/features/forever-extraction-pipeline";
import {
  defaultProjectDatabasePolicy,
  deriveProjectDatabaseOutcome,
  deriveProjectDatabaseState,
  emptyProjectDatabaseStats,
  isKnownProjectConfidenceLevel,
  isProjectStructuredValue,
  mergeProjectDatabaseStats,
  partitionProjectDatabaseIssues,
  projectConfidence,
  projectDatabaseError,
  projectDatabaseWarning,
  projectFieldValueFromFact,
  projectFieldValueSignature,
  sumProjectDatabaseStats,
  unknownProjectConfidence,
} from "@/features/forever-project-database";

import {
  compareKnowledgeSourceVersion,
  compareKnowledgeSourceVersionTotal,
  compareKnowledgeStrings,
  defaultKnowledgeGraphPolicy,
  deriveKnowledgeGraphOutcome,
  deriveKnowledgeGraphState,
  emptyKnowledgeGraphStats,
  formatKnowledgeSourceVersion,
  isKnowledgeStructuredValue,
  isKnownKnowledgeConfidenceLevel,
  isWellFormedKnowledgeSourceVersion,
  knowledgeConfidence,
  knowledgeError,
  knowledgeWarning,
  mergeKnowledgeStats,
  partitionKnowledgeIssues,
  sumKnowledgeStats,
  unknownKnowledgeConfidence,
} from "..";
import { PRICE_SUBJECT, makeFact, makeGraph } from "./fixtures";

describe("reuse: RC4.8 re-exports the neighbouring machinery — the same functions", () => {
  it("reuses the RC4.6 issue, confidence, and structured-value machinery", () => {
    expect(knowledgeError).toBe(projectDatabaseError);
    expect(knowledgeWarning).toBe(projectDatabaseWarning);
    expect(partitionKnowledgeIssues).toBe(partitionProjectDatabaseIssues);
    expect(knowledgeConfidence).toBe(projectConfidence);
    expect(unknownKnowledgeConfidence).toBe(unknownProjectConfidence);
    expect(isKnownKnowledgeConfidenceLevel).toBe(isKnownProjectConfidenceLevel);
    expect(isKnowledgeStructuredValue).toBe(isProjectStructuredValue);
  });

  it("reuses the RC4.5/RC4.4/RC3.3 version machinery and the RC4.7 total guards", () => {
    expect(formatKnowledgeSourceVersion).toBe(formatExtractionVersion);
    expect(compareKnowledgeSourceVersion).toBe(compareExtractionVersion);
    expect(isWellFormedKnowledgeSourceVersion).toBe(isWellFormedCrossValidationSourceVersion);
    expect(compareKnowledgeSourceVersionTotal).toBe(compareCrossValidationSourceVersionTotal);
  });

  it("reuses the RC4.7 string comparison and the RC4.0 lifecycle machinery", () => {
    expect(compareKnowledgeStrings).toBe(compareCrossValidationStrings);
    expect(deriveKnowledgeGraphState).toBe(deriveProjectDatabaseState);
    expect(deriveKnowledgeGraphOutcome).toBe(deriveProjectDatabaseOutcome);
    expect(emptyKnowledgeGraphStats).toBe(emptyProjectDatabaseStats);
    expect(mergeKnowledgeStats).toBe(mergeProjectDatabaseStats);
    expect(sumKnowledgeStats).toBe(sumProjectDatabaseStats);
    expect(defaultKnowledgeGraphPolicy).toBe(defaultProjectDatabasePolicy);
  });

  it("claim signatures are the reused RC4.6 fingerprint through the RC4.7 bridge", () => {
    const fact = makeFact();
    const claim = makeGraph().nodes.find(
      (node) => node.kind === "claim" && node.subjectKey === PRICE_SUBJECT,
    )!;
    expect(claim.signature).toBe(crossSourceReadingSignature(fact));
    expect(claim.signature).toBe(projectFieldValueSignature(projectFieldValueFromFact(fact)));
  });
});
