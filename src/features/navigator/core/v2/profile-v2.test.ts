import { describe, expect, it } from "vitest";

import { emptyAnswers } from "../decision-profile";
import {
  DECISION_PROFILE_VERSION,
  budgetV2FromBand,
  canonicalThbBudget,
  parseFxRateConfig,
  parseStoredProfileV2,
  profileV2FromLegacyAnswers,
  type FxRateConfig,
} from "./profile";

const datedFx: FxRateConfig = {
  source: "operator-provided daily reference",
  effectiveDate: "2026-07-25",
  thbPerUnit: { USD: 36 },
};

describe("BudgetRangeV2", () => {
  it("keeps the original currency — a band is the guest's own statement", () => {
    const budget = budgetV2FromBand("250_500k", "EUR");
    expect(budget).toEqual({
      state: "stated",
      minimum: 250_000,
      maximum: 500_000,
      originalCurrency: "EUR",
    });
  });

  it("treats 'exploring' and no selection as no budget fact", () => {
    expect(budgetV2FromBand("exploring", "USD").state).toBe("exploring");
    expect(budgetV2FromBand(null, "USD").state).toBe("exploring");
  });
});

describe("canonical THB budget", () => {
  it("does not exist without a dated, source-identified rate", () => {
    expect(canonicalThbBudget(budgetV2FromBand("500k_1m", "USD"), null)).toBeNull();
  });

  it("does not exist when the config lacks the original currency", () => {
    expect(canonicalThbBudget(budgetV2FromBand("500k_1m", "EUR"), datedFx)).toBeNull();
  });

  it("exists with a dated verified rate and carries source + date", () => {
    const canonical = canonicalThbBudget(budgetV2FromBand("500k_1m", "USD"), datedFx);
    expect(canonical).not.toBeNull();
    expect(canonical?.minimumTHB).toBe(500_000 * 36);
    expect(canonical?.maximumTHB).toBe(1_000_000 * 36);
    expect(canonical?.conversion).toEqual({
      kind: "converted",
      source: "operator-provided daily reference",
      effectiveDate: "2026-07-25",
      thbPerUnit: 36,
    });
  });

  it("is the identity for a THB original budget — no rate needed, none invented", () => {
    const canonical = canonicalThbBudget(budgetV2FromBand("1m_2_5m", "THB"), null);
    expect(canonical?.conversion).toEqual({ kind: "identity" });
    expect(canonical?.maximumTHB).toBe(2_500_000);
  });

  it("never exists for an exploring budget", () => {
    expect(canonicalThbBudget(budgetV2FromBand("exploring", "USD"), datedFx)).toBeNull();
  });
});

describe("parseFxRateConfig (fail-closed)", () => {
  it("rejects missing source, undated, or non-positive rates", () => {
    expect(parseFxRateConfig(null)).toBeNull();
    expect(parseFxRateConfig({})).toBeNull();
    expect(
      parseFxRateConfig({ source: "x", effectiveDate: "not-a-date", thbPerUnit: { USD: 36 } }),
    ).toBeNull();
    expect(
      parseFxRateConfig({ source: "x", effectiveDate: "2026-07-25", thbPerUnit: { USD: 0 } }),
    ).toBeNull();
    expect(
      parseFxRateConfig({ source: "  ", effectiveDate: "2026-07-25", thbPerUnit: { USD: 36 } }),
    ).toBeNull();
  });

  it("accepts a dated, source-identified config", () => {
    expect(
      parseFxRateConfig({ source: "x", effectiveDate: "2026-07-25", thbPerUnit: { USD: 36.2 } }),
    ).toEqual({ source: "x", effectiveDate: "2026-07-25", thbPerUnit: { USD: 36.2 } });
  });
});

describe("legacy adapter", () => {
  it("lifts legacy answers with every Search Essential honestly unknown", () => {
    const profile = profileV2FromLegacyAnswers({
      ...emptyAnswers(),
      motivations: ["investment", "slower_life"],
      goals: ["rental_income"],
      budget: "500k_1m",
      timeline: "3_6m",
      concerns: ["ownership"],
      note: "hello",
    });
    expect(profile.profileVersion).toBe(DECISION_PROFILE_VERSION);
    expect(profile.purchasePurpose).toBe("both");
    expect(profile.budget).toEqual({
      state: "stated",
      minimum: 500_000,
      maximum: 1_000_000,
      originalCurrency: "USD",
    });
    expect(profile.canonicalThb).toBeNull(); // no FX given → no THB claim
    expect(profile.essentials).toEqual({
      propertyType: null,
      bedrooms: null,
      preferredAreas: [],
      helpMeChooseArea: false,
      readiness: null,
    });
    expect(profile.confirmedAt).toBeNull();
  });

  it("derives a purely lifestyle purpose without investment signals", () => {
    const profile = profileV2FromLegacyAnswers({
      ...emptyAnswers(),
      motivations: ["second_home"],
      goals: ["peace_privacy"],
    });
    expect(profile.purchasePurpose).toBe("lifestyle");
  });

  it("derives 'exploring' from empty answers", () => {
    expect(profileV2FromLegacyAnswers(emptyAnswers()).purchasePurpose).toBe("exploring");
  });
});

describe("parseStoredProfileV2 (fail-closed versioned parsing)", () => {
  const valid = profileV2FromLegacyAnswers({
    ...emptyAnswers(),
    motivations: ["second_home"],
    goals: ["peace_privacy"],
    budget: "250_500k",
    timeline: "ready_now",
    concerns: ["ownership"],
  });

  it("round-trips a valid profile", () => {
    const parsed = parseStoredProfileV2(JSON.parse(JSON.stringify(valid)));
    expect(parsed).toEqual(valid);
  });

  it("rejects malformed, unversioned, or obsolete payloads", () => {
    expect(parseStoredProfileV2(null)).toBeNull();
    expect(parseStoredProfileV2("string")).toBeNull();
    expect(parseStoredProfileV2({})).toBeNull();
    expect(parseStoredProfileV2({ ...valid, profileVersion: 1 })).toBeNull();
    expect(parseStoredProfileV2({ ...valid, profileVersion: 3 })).toBeNull();
    expect(parseStoredProfileV2({ ...valid, flowMode: "turbo" })).toBeNull();
    expect(parseStoredProfileV2({ ...valid, purchasePurpose: "speculation" })).toBeNull();
    expect(parseStoredProfileV2({ ...valid, budget: null })).toBeNull();
    expect(parseStoredProfileV2({ ...valid, essentials: null })).toBeNull();
  });

  it("never trusts an undated or unsourced stored conversion", () => {
    const withBadConversion = {
      ...JSON.parse(JSON.stringify(valid)),
      canonicalThb: {
        minimumTHB: 1,
        maximumTHB: 2,
        conversion: { kind: "converted", source: "", effectiveDate: "2026-07-25", thbPerUnit: 36 },
      },
    };
    expect(parseStoredProfileV2(withBadConversion)?.canonicalThb).toBeNull();

    const undated = {
      ...JSON.parse(JSON.stringify(valid)),
      canonicalThb: {
        minimumTHB: 1,
        maximumTHB: 2,
        conversion: { kind: "converted", source: "x", effectiveDate: "recently", thbPerUnit: 36 },
      },
    };
    expect(parseStoredProfileV2(undated)?.canonicalThb).toBeNull();
  });
});
