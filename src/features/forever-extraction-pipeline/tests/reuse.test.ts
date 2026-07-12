import { describe, expect, it } from "vitest";

import {
  compareProjectSourceVersion,
  formatProjectSourceVersion,
  isKnownProjectSourceDocumentType,
  normalizeProjectSourceSlug,
  partitionProjectSourceIssues,
  projectSourceDocumentKey,
  projectSourceError,
  projectSourceVersion,
  projectSourceWarning,
  isAbsent as rc44IsAbsent,
  isNonEmptyString as rc44IsNonEmptyString,
} from "@/features/forever-project-sources";
import {
  defaultProjectIntegrationPolicy,
  deriveProjectIntegrationOutcome,
  deriveProjectIntegrationState,
  emptyProjectIntegrationStats,
  mergeProjectIntegrationStats,
  sumProjectIntegrationStats,
  validateProjectIntegrationPolicy,
} from "@/features/forever-project-integration";
import { projectCanonicalId } from "@/features/forever-project-template";

import {
  compareExtractionVersion,
  defaultExtractionPolicy,
  deriveExtractionOutcome,
  deriveExtractionState,
  emptyExtractionStats,
  extractionError,
  extractionProjectId,
  extractionVersion,
  extractionWarning,
  formatExtractionVersion,
  isAbsent,
  isNonEmptyString,
  mergeExtractionStats,
  normalizeExtractionSlug,
  partitionExtractionIssues,
  planExtraction,
  sumExtractionStats,
  validateExtractionPolicy,
} from "..";
import { makeContext, makeRequest } from "./fixtures";

describe("reuse of existing foundations", () => {
  it("reuses the RC4.4/RC3.3 issue machinery — the very same functions, never restatements", () => {
    expect(extractionError).toBe(projectSourceError);
    expect(extractionWarning).toBe(projectSourceWarning);
    expect(partitionExtractionIssues).toBe(partitionProjectSourceIssues);
  });

  it("reuses the RC4.4/RC3.3 version machinery wholesale", () => {
    expect(extractionVersion).toBe(projectSourceVersion);
    expect(formatExtractionVersion).toBe(formatProjectSourceVersion);
    expect(compareExtractionVersion).toBe(compareProjectSourceVersion);
  });

  it("reuses the RC4.4 slug, project-id, and string/absence guards verbatim", () => {
    expect(normalizeExtractionSlug).toBe(normalizeProjectSourceSlug);
    expect(extractionProjectId).toBe(projectCanonicalId);
    expect(isNonEmptyString).toBe(rc44IsNonEmptyString);
    expect(isAbsent).toBe(rc44IsAbsent);
  });

  it("reuses the RC4.0 policy, stats, and lifecycle machinery wholesale", () => {
    expect(defaultExtractionPolicy).toBe(defaultProjectIntegrationPolicy);
    expect(validateExtractionPolicy).toBe(validateProjectIntegrationPolicy);
    expect(emptyExtractionStats).toBe(emptyProjectIntegrationStats);
    expect(mergeExtractionStats).toBe(mergeProjectIntegrationStats);
    expect(sumExtractionStats).toBe(sumProjectIntegrationStats);
    expect(deriveExtractionState).toBe(deriveProjectIntegrationState);
    expect(deriveExtractionOutcome).toBe(deriveProjectIntegrationOutcome);
  });

  it("plans against RC4.4 sources directly: document key, id, and version are the RC4.4 ones", () => {
    const request = makeRequest();
    const plan = planExtraction(makeContext(), request).data[0];
    expect(plan.documentKey).toBe(projectSourceDocumentKey(request.source.identity));
    expect(plan.sourceId).toBe(request.source.identity.id);
    expect(plan.sourceVersion).toEqual(request.source.version);
    expect(isKnownProjectSourceDocumentType(request.source.descriptor.documentType)).toBe(true);
  });
});
