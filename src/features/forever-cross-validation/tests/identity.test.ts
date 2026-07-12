import { describe, expect, it } from "vitest";

import {
  normalizeExtractionSlug,
  extractionFactSubjectKey,
  extractionProjectId,
  groupExtractionFactsBySubject,
} from "@/features/forever-extraction-pipeline";
import {
  normalizeProjectDatabaseSlug,
  projectDatabaseProjectId,
} from "@/features/forever-project-database";

import {
  CROSS_VALIDATION_ID_PREFIXES,
  crossValidationExpectedSubjectFor,
  crossValidationFactSubjectKey,
  crossValidationFindingIdFor,
  crossValidationProjectId,
  crossValidationReportIdFor,
  crossValidationSubjectFor,
  groupCrossValidationFactsBySubject,
  normalizeCrossValidationSlug,
} from "..";
import { makeFact } from "./fixtures";

describe("identity", () => {
  it("derives deterministic report ids, with the batch participating only when stated", () => {
    expect(crossValidationReportIdFor("coralina")).toBe("xrep_coralina");
    expect(crossValidationReportIdFor("Coralina Beach")).toBe("xrep_coralina-beach");
    expect(crossValidationReportIdFor("coralina", "2026 07")).toBe("xrep_coralina-2026-07");
    expect(CROSS_VALIDATION_ID_PREFIXES.report).toBe("xrep_");
  });

  it("derives deterministic finding ids from kind and ordinal", () => {
    expect(crossValidationFindingIdFor("coralina", "conflict", 1)).toBe("xfnd_coralina-conflict-1");
    expect(crossValidationFindingIdFor("coralina", "stale_revision", 3)).toBe(
      "xfnd_coralina-stale-revision-3",
    );
  });

  it("reuses the one slug rule and the one proj_ convention — the very same functions", () => {
    expect(normalizeCrossValidationSlug).toBe(normalizeProjectDatabaseSlug);
    expect(normalizeCrossValidationSlug).toBe(normalizeExtractionSlug);
    expect(crossValidationProjectId).toBe(projectDatabaseProjectId);
    expect(crossValidationProjectId).toBe(extractionProjectId);
    expect(crossValidationProjectId("coralina")).toBe("proj_coralina");
  });
});

describe("subjects", () => {
  it("reuses the RC4.5 subject rule — the very same functions", () => {
    expect(crossValidationFactSubjectKey).toBe(extractionFactSubjectKey);
    expect(groupCrossValidationFactsBySubject).toBe(groupExtractionFactsBySubject);
  });

  it("derives a subject from a fact without inventing a field path", () => {
    const fact = makeFact();
    expect(crossValidationSubjectFor(fact)).toEqual({
      key: "proj_coralina:price:pricing.basePrice",
      projectId: "proj_coralina",
      factType: "price",
      fieldPath: "pricing.basePrice",
    });
    const pathless = makeFact({ fieldPath: undefined });
    const subject = crossValidationSubjectFor(pathless);
    expect(subject.key).toBe("proj_coralina:price");
    expect("fieldPath" in subject).toBe(false);
  });

  it("derives expected subjects under the explicit unknown fact type", () => {
    expect(crossValidationExpectedSubjectFor("proj_coralina", "units.area1br")).toEqual({
      key: "proj_coralina:unknown:units.area1br",
      projectId: "proj_coralina",
      factType: "unknown",
      fieldPath: "units.area1br",
    });
  });
});
