import { describe, expect, it } from "vitest";

import {
  compareExtractionVersion,
  extractionError,
  extractionFactSubjectKey,
  extractionWarning,
  formatExtractionVersion,
  meetsExtractionConfidence,
  partitionExtractionIssues,
  unknownExtractionConfidence,
} from "@/features/forever-extraction-pipeline";
import {
  defaultProjectIntegrationPolicy,
  deriveProjectIntegrationOutcome,
  deriveProjectIntegrationState,
  emptyProjectIntegrationStats,
  mergeProjectIntegrationStats,
} from "@/features/forever-project-integration";
import { latestProjectSourceVersion } from "@/features/forever-project-sources";
import {
  isProjectStructuredValue,
  projectDatabaseError,
  projectDatabaseWarning,
} from "@/features/forever-project-database";

import {
  compareCrossValidationSourceVersion,
  crossValidationError,
  crossValidationFactSubjectKey,
  crossValidationWarning,
  defaultCrossValidationPolicy,
  deriveCrossValidationOutcome,
  deriveCrossValidationState,
  emptyCrossValidationStats,
  formatCrossValidationSourceVersion,
  isCrossValidationStructuredValue,
  latestCrossValidationSourceVersion,
  meetsCrossValidationConfidence,
  mergeCrossValidationStats,
  partitionCrossValidationIssues,
  unknownCrossValidationConfidence,
} from "..";

describe("reuse — never restatement", () => {
  it("issues, severities, and partitioning are the reused RC3.3 machinery", () => {
    expect(crossValidationError).toBe(projectDatabaseError);
    expect(crossValidationError).toBe(extractionError);
    expect(crossValidationWarning).toBe(projectDatabaseWarning);
    expect(crossValidationWarning).toBe(extractionWarning);
    expect(partitionCrossValidationIssues).toBe(partitionExtractionIssues);
  });

  it("confidence, structured values, and subject keys are the reused RC4.5 machinery", () => {
    expect(unknownCrossValidationConfidence).toBe(unknownExtractionConfidence);
    expect(meetsCrossValidationConfidence).toBe(meetsExtractionConfidence);
    expect(isCrossValidationStructuredValue).toBe(isProjectStructuredValue);
    expect(crossValidationFactSubjectKey).toBe(extractionFactSubjectKey);
  });

  it("versions are the reused RC3.3 shape through RC4.4/RC4.5", () => {
    expect(compareCrossValidationSourceVersion).toBe(compareExtractionVersion);
    expect(formatCrossValidationSourceVersion).toBe(formatExtractionVersion);
    expect(latestCrossValidationSourceVersion).toBe(latestProjectSourceVersion);
  });

  it("lifecycle, stats, and policy are the reused RC4.0 machinery", () => {
    expect(deriveCrossValidationState).toBe(deriveProjectIntegrationState);
    expect(deriveCrossValidationOutcome).toBe(deriveProjectIntegrationOutcome);
    expect(emptyCrossValidationStats).toBe(emptyProjectIntegrationStats);
    expect(mergeCrossValidationStats).toBe(mergeProjectIntegrationStats);
    expect(defaultCrossValidationPolicy).toBe(defaultProjectIntegrationPolicy);
  });
});
