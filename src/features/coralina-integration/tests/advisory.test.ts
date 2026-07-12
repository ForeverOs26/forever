import { INVESTMENT_SCORE_UNAVAILABLE } from "@/features/advisory/investment-intelligence";
import { RENTAL_SCORE_UNAVAILABLE } from "@/features/advisory/rental-intelligence";
import { describe, expect, it } from "vitest";

import { buildCoralinaRecord } from "../adapters/coralina-canonical";
import { buildCoralinaProjectDetail } from "../adapters/coralina-project-detail";
import { deriveCoralinaAdvisory } from "../integration/coralina-advisory";

const INSUFFICIENT = "Insufficient verified data";

describe("Coralina advisory compatibility (reuses RC2.1–RC2.9)", () => {
  it("feeds the canonical project into the existing derivations without error", () => {
    const advisory = deriveCoralinaAdvisory();
    expect(advisory.project.core.name).toBe("CORALINA KAMALA");
    expect(advisory.investment).toBeDefined();
    expect(advisory.rental).toBeDefined();
    expect(advisory.location).toBeDefined();
    expect(advisory.passport).toBeDefined();
    expect(advisory.summary).toBeDefined();
    expect(advisory.report).toBeDefined();
    expect(advisory.strategy).toBeDefined();
  });

  it("stays conservative given partial data (no fabricated scores or verdicts)", () => {
    const { investment, rental, passport } = deriveCoralinaAdvisory();
    // No numeric scores are ever produced by the reused derivations.
    expect(investment.investmentScore).toBe(INVESTMENT_SCORE_UNAVAILABLE);
    expect(rental.rentalScore).toBe(RENTAL_SCORE_UNAVAILABLE);
    // Coralina lacks a developer, construction status, verified price, and
    // rental/investment evidence, so the overall verdict is the most conservative.
    expect(passport.overallVerdict.readinessVerdict).toBe(INSUFFICIENT);
    expect(investment.readinessVerdict).toBe(INSUFFICIENT);
    expect(rental.readinessVerdict).toBe(INSUFFICIENT);
  });

  it("is deterministic when a fixed timestamp is supplied", () => {
    const opts = { generatedAt: "2026-07-12T00:00:00.000Z" };
    expect(deriveCoralinaAdvisory(opts)).toEqual(deriveCoralinaAdvisory(opts));
  });

  it("stays pure — the ProjectDetail builder never mutates its record", () => {
    const record = buildCoralinaRecord();
    const snapshot = structuredClone(record);
    buildCoralinaProjectDetail(record);
    expect(record).toEqual(snapshot);
  });

  it("surfaces verified media and documents to the advisory view", () => {
    const project = buildCoralinaProjectDetail();
    expect(project.units).toHaveLength(198);
    expect(project.media.unitPlans.length).toBeGreaterThan(0);
    expect(project.media.brochures.length).toBeGreaterThan(0);
    // No verified price is surfaced (currency gap): every unit price stays null.
    expect(project.units.every((u) => u.basePriceTHB === null)).toBe(true);
    expect(project.developer).toBeNull();
  });
});
