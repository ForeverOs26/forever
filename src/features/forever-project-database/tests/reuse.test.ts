import { describe, expect, it } from "vitest";

import {
  compareExtractionVersion,
  extractionError,
  extractionProjectId,
  extractionVersion,
  extractionWarning,
  formatExtractionVersion,
  isKnownExtractionValidationStatus,
  isAbsent as rc45IsAbsent,
  isNonEmptyString as rc45IsNonEmptyString,
  extractionConfidence,
  isExtractionStructuredValue,
  partitionExtractionIssues,
  unknownExtractionConfidence,
  validateExtractionVersion,
} from "@/features/forever-extraction-pipeline";
import {
  defaultProjectIntegrationPolicy,
  deriveProjectIntegrationOutcome,
  deriveProjectIntegrationState,
  emptyProjectIntegrationStats,
  isKnownProjectIntegrationState,
  mergeProjectIntegrationStats,
  sumProjectIntegrationStats,
  validateProjectIntegrationPolicy,
} from "@/features/forever-project-integration";
import {
  normalizeProjectSourceSlug,
  projectSourceVersion,
} from "@/features/forever-project-sources";
import { projectCanonicalId } from "@/features/forever-project-template";

import {
  compareProjectRecordVersion,
  defaultProjectDatabasePolicy,
  deriveProjectDatabaseOutcome,
  deriveProjectDatabaseState,
  emptyProjectDatabaseStats,
  formatProjectRecordVersion,
  isAbsent,
  isKnownProjectDatabaseState,
  isKnownProjectFieldValidationStatus,
  isNonEmptyString,
  isProjectStructuredValue,
  mergeProjectDatabaseStats,
  normalizeProjectDatabaseSlug,
  partitionProjectDatabaseIssues,
  projectConfidence,
  projectDatabaseError,
  projectDatabaseProjectId,
  projectDatabaseWarning,
  projectFieldValueFromFact,
  projectRecordVersion,
  sumProjectDatabaseStats,
  unknownProjectConfidence,
  validateProjectDatabasePolicy,
  validateProjectRecordVersion,
} from "..";
import { makeFact } from "./fixtures";

describe("reuse of existing foundations", () => {
  it("reuses the RC4.5/RC4.4/RC3.3 issue machinery — the very same functions", () => {
    expect(projectDatabaseError).toBe(extractionError);
    expect(projectDatabaseWarning).toBe(extractionWarning);
    expect(partitionProjectDatabaseIssues).toBe(partitionExtractionIssues);
  });

  it("reuses the RC4.5/RC4.4/RC3.3 version machinery wholesale", () => {
    expect(projectRecordVersion).toBe(extractionVersion);
    expect(projectRecordVersion).toBe(projectSourceVersion);
    expect(formatProjectRecordVersion).toBe(formatExtractionVersion);
    expect(compareProjectRecordVersion).toBe(compareExtractionVersion);
    expect(validateProjectRecordVersion).toBe(validateExtractionVersion);
  });

  it("reuses the RC4.2 slug and project-id conventions verbatim", () => {
    expect(normalizeProjectDatabaseSlug).toBe(normalizeProjectSourceSlug);
    expect(projectDatabaseProjectId).toBe(extractionProjectId);
    expect(projectDatabaseProjectId).toBe(projectCanonicalId);
    expect(isNonEmptyString).toBe(rc45IsNonEmptyString);
    expect(isAbsent).toBe(rc45IsAbsent);
  });

  it("reuses the RC4.0 policy, stats, and lifecycle machinery wholesale", () => {
    expect(defaultProjectDatabasePolicy).toBe(defaultProjectIntegrationPolicy);
    expect(validateProjectDatabasePolicy).toBe(validateProjectIntegrationPolicy);
    expect(emptyProjectDatabaseStats).toBe(emptyProjectIntegrationStats);
    expect(mergeProjectDatabaseStats).toBe(mergeProjectIntegrationStats);
    expect(sumProjectDatabaseStats).toBe(sumProjectIntegrationStats);
    expect(deriveProjectDatabaseState).toBe(deriveProjectIntegrationState);
    expect(deriveProjectDatabaseOutcome).toBe(deriveProjectIntegrationOutcome);
    expect(isKnownProjectDatabaseState).toBe(isKnownProjectIntegrationState);
  });

  it("reuses the RC4.5 confidence, value, and status machinery verbatim", () => {
    expect(projectConfidence).toBe(extractionConfidence);
    expect(unknownProjectConfidence).toBe(unknownExtractionConfidence);
    expect(isProjectStructuredValue).toBe(isExtractionStructuredValue);
    expect(isKnownProjectFieldValidationStatus).toBe(isKnownExtractionValidationStatus);
  });

  it("settles RC4.5 facts directly: ids, provenance, evidence, and confidence are the fact's own", () => {
    const fact = makeFact();
    const value = projectFieldValueFromFact(fact);
    expect(value.factId).toBe(fact.id);
    expect(value.sourceIds).toEqual([fact.sourceId]);
    expect(value.provenance).toEqual(fact.provenance);
    expect(value.evidence).toEqual([fact.evidence]);
    expect(value.confidence).toEqual(fact.confidence);
  });
});
