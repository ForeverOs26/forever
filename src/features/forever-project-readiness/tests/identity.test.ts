import { describe, expect, it } from "vitest";

import {
  normalizeProjectDatabaseSlug,
  projectDatabaseProjectId,
} from "@/features/forever-project-database";

import {
  READINESS_ID_PREFIXES,
  normalizeReadinessSlug,
  readinessEvaluationIdFor,
  readinessProfileIdFor,
  readinessProjectId,
  readinessReportIdFor,
} from "..";

describe("identity", () => {
  it("reuses the RC4.6 slug rule and RC4.2 proj_ convention — the same functions", () => {
    expect(normalizeReadinessSlug).toBe(normalizeProjectDatabaseSlug);
    expect(readinessProjectId).toBe(projectDatabaseProjectId);
  });

  it("declares the rrep_/reva_/rprf_ prefixes", () => {
    expect(READINESS_ID_PREFIXES).toEqual({
      report: "rrep_",
      evaluation: "reva_",
      profile: "rprf_",
    });
  });

  it("derives report ids from the project slug, with the batch participating only when stated", () => {
    expect(readinessReportIdFor("coralina")).toBe("rrep_coralina");
    expect(readinessReportIdFor("Coralina  Project")).toBe("rrep_coralina-project");
    expect(readinessReportIdFor("coralina", "2026-07")).toBe("rrep_coralina-2026-07");
  });

  it("derives evaluation ids from slug, kind, and ordinal", () => {
    expect(readinessEvaluationIdFor("coralina", "field_present", 1)).toBe(
      "reva_coralina-field-present-1",
    );
    expect(readinessEvaluationIdFor("coralina", "source_present", 3)).toBe(
      "reva_coralina-source-present-3",
    );
  });

  it("derives profile ids from the profile's own slug", () => {
    expect(readinessProfileIdFor("Minimum Intake")).toBe("rprf_minimum-intake");
  });

  it("is deterministic: the same input always derives the same id", () => {
    expect(readinessReportIdFor("coralina", "b1")).toBe(readinessReportIdFor("coralina", "b1"));
    expect(readinessEvaluationIdFor("coralina", "findings_clear", 2)).toBe(
      readinessEvaluationIdFor("coralina", "findings_clear", 2),
    );
  });
});
