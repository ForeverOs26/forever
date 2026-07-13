import { describe, expect, it } from "vitest";

import { buildCoralinaVerification } from "../validation/coralina-verification";

describe("Coralina integration verification result", () => {
  it("is deterministic", () => {
    expect(buildCoralinaVerification()).toEqual(buildCoralinaVerification());
  });

  it("reports the present sources and the entities that were created", () => {
    const result = buildCoralinaVerification();
    expect(result.sources).toHaveLength(6);
    expect(result.sourcesValid).toBe(true);

    const byName = new Map(result.entities.map((e) => [e.entity, e]));
    expect(byName.get("project")?.present).toBe(true);
    expect(byName.get("location")?.present).toBe(true);
    expect(byName.get("units")?.count).toBe(198);
    expect(byName.get("media")?.present).toBe(true);
    expect(byName.get("documents")?.present).toBe(true);
  });

  it("reports the absent entities as gaps, never fabricated", () => {
    const byName = new Map(buildCoralinaVerification().entities.map((e) => [e.entity, e]));
    for (const absent of [
      "developer",
      "paymentPlans",
      "constructionProgress",
      "rentalInformation",
      "investmentInformation",
    ]) {
      expect(byName.get(absent)?.present).toBe(false);
      expect(byName.get(absent)?.count).toBe(0);
    }
  });

  it("confirms every validation stage passed", () => {
    const result = buildCoralinaVerification();
    expect(result.canonicalValid).toBe(true);
    expect(result.canonicalIssueCount).toBe(0);
    expect(result.importPayloadValid).toBe(true);
    expect(result.integrationValid).toBe(true);
    expect(result.referencesResolved).toBe(true);
    expect(result.unresolvedReferenceCount).toBe(0);
  });

  it("lists verified facts and remaining data gaps", () => {
    const result = buildCoralinaVerification();
    expect(result.verifiedFacts.some((f) => f.includes("The Title Coralina Kamala"))).toBe(true);
    expect(result.verifiedFacts.some((f) => f.includes("198"))).toBe(true);
    expect(result.dataGaps.length).toBeGreaterThan(0);
  });

  it("marks the slice ready for preliminary advisory while the advisory verdict stays conservative", () => {
    const result = buildCoralinaVerification();
    // Structural readiness for consumption is true...
    expect(result.readyForPreliminaryAdvisory).toBe(true);
    // ...but the surfaced (existing) advisory verdict remains conservative.
    expect(result.advisoryReadinessVerdict).toBe("Insufficient verified data");
  });
});
