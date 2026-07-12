import { describe, expect, it } from "vitest";

import { isKnownExtractionValidationStatus } from "@/features/forever-extraction-pipeline";

import {
  PROJECT_RECORD_STATUSES,
  PROJECT_VALUE_STATUSES,
  isCurrentProjectValueStatus,
  isKnownProjectFieldValidationStatus,
  isKnownProjectRecordStatus,
  isKnownProjectValueStatus,
  projectValueStatusCarriesValue,
} from "..";

describe("standing vocabularies", () => {
  it("declares the five value standings — absence is always a stated fact", () => {
    expect(PROJECT_VALUE_STATUSES).toEqual([
      "current",
      "superseded",
      "removed",
      "missing",
      "unknown",
    ]);
    for (const status of PROJECT_VALUE_STATUSES) {
      expect(isKnownProjectValueStatus(status)).toBe(true);
    }
    expect(isKnownProjectValueStatus("deleted")).toBe(false);
    expect(isKnownProjectValueStatus(null)).toBe(false);
  });

  it("only `current` stands; history keeps what stood, stated absence stays bare", () => {
    expect(isCurrentProjectValueStatus("current")).toBe(true);
    for (const status of ["superseded", "removed", "missing", "unknown"] as const) {
      expect(isCurrentProjectValueStatus(status)).toBe(false);
    }
    // Superseded and removed entries keep the reading they once were;
    // missing and unknown entries state an absence that was never a reading.
    expect(projectValueStatusCarriesValue("current")).toBe(true);
    expect(projectValueStatusCarriesValue("superseded")).toBe(true);
    expect(projectValueStatusCarriesValue("removed")).toBe(true);
    for (const status of ["missing", "unknown"] as const) {
      expect(projectValueStatusCarriesValue(status)).toBe(false);
    }
  });

  it("declares the record standings", () => {
    expect(PROJECT_RECORD_STATUSES).toEqual(["draft", "active", "archived"]);
    for (const status of PROJECT_RECORD_STATUSES) {
      expect(isKnownProjectRecordStatus(status)).toBe(true);
    }
    expect(isKnownProjectRecordStatus("published")).toBe(false);
  });

  it("reuses the RC4.5 validation-status guard verbatim", () => {
    expect(isKnownProjectFieldValidationStatus).toBe(isKnownExtractionValidationStatus);
    expect(isKnownProjectFieldValidationStatus("unvalidated")).toBe(true);
    expect(isKnownProjectFieldValidationStatus("valid")).toBe(true);
    expect(isKnownProjectFieldValidationStatus("invalid")).toBe(true);
    expect(isKnownProjectFieldValidationStatus("maybe")).toBe(false);
  });
});
