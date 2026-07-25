/**
 * Adversarial tests for the ONE canonical profile schema (PR #102 corrective
 * item 10). Everything here is a payload a tampered client could transport;
 * all of it must be rejected outright rather than coerced, truncated, or cast.
 */

import { describe, expect, it } from "vitest";

import {
  DECISION_PROFILE_VERSION,
  MAX_PROFILE_PAYLOAD_BYTES,
  derivePurchasePurpose,
  parseStoredProfileV2,
  statedBudget,
  validateBudgetRange,
  type DecisionProfileV2,
} from "./profile";

function validProfile(overrides: Partial<DecisionProfileV2> = {}): DecisionProfileV2 {
  return {
    profileVersion: DECISION_PROFILE_VERSION,
    flowMode: "quick",
    purchasePurpose: "lifestyle",
    motivations: [],
    goals: [],
    concerns: [],
    note: "",
    budget: statedBudget(250_000, 500_000, "EUR"),
    canonicalThb: null,
    timeline: "3_6m",
    essentials: {
      propertyType: "condominium",
      bedrooms: null,
      preferredAreas: [],
      helpMeChooseArea: false,
      readiness: null,
    },
    preferredLanguage: "English",
    confirmedAt: "2026-07-25T10:00:00.000Z",
    ...overrides,
  };
}

const parse = (profile: unknown) => parseStoredProfileV2(JSON.parse(JSON.stringify(profile)));

describe("canonical schema — accepted shape", () => {
  it("round-trips a valid confirmed Quick profile", () => {
    expect(parse(validProfile())).toEqual(validProfile());
  });
});

describe("canonical schema — enum and key adversaries", () => {
  it("rejects invented motivation, goal, concern and timeline keys", () => {
    expect(parse(validProfile({ motivations: ["not_a_key"] as never }))).toBeNull();
    expect(parse(validProfile({ goals: ["profit"] as never }))).toBeNull();
    expect(parse(validProfile({ concerns: ["everything"] as never }))).toBeNull();
    expect(parse(validProfile({ timeline: "someday" as never }))).toBeNull();
  });

  it("rejects duplicate answer keys and over-long answer lists", () => {
    expect(
      parse(
        validProfile({
          flowMode: "full",
          motivations: ["second_home", "second_home"] as never,
        }),
      ),
    ).toBeNull();
    expect(
      parse(
        validProfile({
          motivations: ["second_home", "retirement", "investment", "asia_base"] as never,
        }),
      ),
    ).toBeNull();
  });

  it("rejects unknown top-level and nested keys", () => {
    expect(parse({ ...validProfile(), injected: true })).toBeNull();
    expect(
      parse({ ...validProfile(), essentials: { ...validProfile().essentials, injected: 1 } }),
    ).toBeNull();
    expect(
      parse({ ...validProfile(), budget: { ...validProfile().budget, injected: 1 } }),
    ).toBeNull();
  });

  it("rejects Search Essential values outside their enums", () => {
    expect(
      parse(
        validProfile({
          essentials: { ...validProfile().essentials, propertyType: "castle" as never },
        }),
      ),
    ).toBeNull();
    expect(
      parse(validProfile({ essentials: { ...validProfile().essentials, bedrooms: "7" as never } })),
    ).toBeNull();
    expect(
      parse(
        validProfile({ essentials: { ...validProfile().essentials, readiness: "maybe" as never } }),
      ),
    ).toBeNull();
  });
});

describe("canonical schema — budget geometry", () => {
  it("rejects non-finite, negative, and absurd amounts", () => {
    expect(parse(validProfile({ budget: statedBudget(-1, 100, "USD") }))).toBeNull();
    expect(parse(validProfile({ budget: statedBudget(0, 1e15, "USD") }))).toBeNull();
    // NaN/Infinity do not survive JSON, so assert the validator directly too.
    expect(validateBudgetRange(statedBudget(Number.NaN, null, "USD"))).toBe("amount_invalid");
    expect(validateBudgetRange(statedBudget(Number.POSITIVE_INFINITY, null, "USD"))).toBe(
      "amount_invalid",
    );
  });

  it("rejects an inverted range", () => {
    expect(parse(validProfile({ budget: statedBudget(900_000, 100_000, "USD") }))).toBeNull();
    expect(validateBudgetRange(statedBudget(900_000, 100_000, "USD"))).toBe("range_inverted");
  });

  it("rejects a stated budget with no amounts or no currency", () => {
    expect(
      parse(
        validProfile({
          budget: { state: "stated", minimum: null, maximum: null, originalCurrency: "USD" },
        }),
      ),
    ).toBeNull();
    expect(
      parse(
        validProfile({
          budget: { state: "stated", minimum: 1, maximum: 2, originalCurrency: null },
        }),
      ),
    ).toBeNull();
  });

  it("rejects an exploring budget that still carries amounts or a currency", () => {
    expect(
      parse(
        validProfile({
          budget: { state: "exploring", minimum: 100, maximum: null, originalCurrency: null },
        }),
      ),
    ).toBeNull();
    expect(
      parse(
        validProfile({
          budget: { state: "exploring", minimum: null, maximum: null, originalCurrency: "USD" },
        }),
      ),
    ).toBeNull();
  });

  it("accepts every allowed currency with explicit numeric amounts", () => {
    for (const currency of ["USD", "EUR", "GBP", "THB", "RUB", "CNY"] as const) {
      const profile = validProfile({
        budget: statedBudget(1_000_000, 2_000_000, currency),
        canonicalThb:
          currency === "THB"
            ? { minimumTHB: 1_000_000, maximumTHB: 2_000_000, conversion: { kind: "identity" } }
            : null,
      });
      expect(parse(profile)).not.toBeNull();
    }
  });
});

describe("canonical schema — canonical THB provenance and arithmetic", () => {
  it("rejects a conversion whose arithmetic does not follow from its rate", () => {
    expect(
      parse(
        validProfile({
          budget: statedBudget(100, 200, "USD"),
          canonicalThb: {
            minimumTHB: 999,
            maximumTHB: 7_200,
            conversion: {
              kind: "converted",
              source: "operator",
              effectiveDate: "2026-07-25",
              thbPerUnit: 36,
            },
          },
        }),
      ),
    ).toBeNull();
  });

  it("accepts a conversion whose arithmetic does follow", () => {
    expect(
      parse(
        validProfile({
          budget: statedBudget(100, 200, "USD"),
          canonicalThb: {
            minimumTHB: 3_600,
            maximumTHB: 7_200,
            conversion: {
              kind: "converted",
              source: "operator",
              effectiveDate: "2026-07-25",
              thbPerUnit: 36,
            },
          },
        }),
      ),
    ).not.toBeNull();
  });

  it("rejects identity provenance for a non-THB budget and vice versa", () => {
    expect(
      parse(
        validProfile({
          budget: statedBudget(100, 200, "USD"),
          canonicalThb: { minimumTHB: 100, maximumTHB: 200, conversion: { kind: "identity" } },
        }),
      ),
    ).toBeNull();
    expect(
      parse(
        validProfile({
          budget: statedBudget(100, 200, "THB"),
          canonicalThb: {
            minimumTHB: 3_600,
            maximumTHB: 7_200,
            conversion: {
              kind: "converted",
              source: "operator",
              effectiveDate: "2026-07-25",
              thbPerUnit: 36,
            },
          },
        }),
      ),
    ).toBeNull();
  });

  it("rejects an undated or unsourced conversion and a canonical THB with no budget", () => {
    expect(
      parse(
        validProfile({
          budget: statedBudget(100, null, "USD"),
          canonicalThb: {
            minimumTHB: 3_600,
            maximumTHB: null,
            conversion: {
              kind: "converted",
              source: "",
              effectiveDate: "2026-07-25",
              thbPerUnit: 36,
            },
          },
        }),
      ),
    ).toBeNull();
    expect(
      parse(
        validProfile({
          budget: { state: "exploring", minimum: null, maximum: null, originalCurrency: null },
          canonicalThb: { minimumTHB: 1, maximumTHB: 2, conversion: { kind: "identity" } },
        }),
      ),
    ).toBeNull();
  });
});

describe("canonical schema — completeness, bounds and payload size", () => {
  it("rejects a confirmed Quick profile missing its required answers", () => {
    expect(
      parse(validProfile({ essentials: { ...validProfile().essentials, propertyType: null } })),
    ).toBeNull();
    expect(parse(validProfile({ timeline: null }))).toBeNull();
  });

  it("rejects a confirmed Full profile missing NAV-001 answers or essentials", () => {
    expect(parse(validProfile({ flowMode: "full" }))).toBeNull();
  });

  it("accepts a complete confirmed Full profile", () => {
    const full = validProfile({
      flowMode: "full",
      motivations: ["second_home"],
      goals: ["peace_privacy"],
      concerns: ["ownership"],
      purchasePurpose: "lifestyle",
      essentials: {
        propertyType: "villa",
        bedrooms: "2",
        preferredAreas: ["Bang Tao"],
        helpMeChooseArea: false,
        readiness: "ready",
      },
    });
    expect(parse(full)).not.toBeNull();
  });

  it("rejects mutually exclusive area answers and over-long area lists", () => {
    expect(
      parse(
        validProfile({
          essentials: {
            ...validProfile().essentials,
            preferredAreas: ["Bang Tao"],
            helpMeChooseArea: true,
          },
        }),
      ),
    ).toBeNull();
    expect(
      parse(
        validProfile({
          essentials: {
            ...validProfile().essentials,
            preferredAreas: Array.from({ length: 9 }, (_, index) => `Area ${index}`),
          },
        }),
      ),
    ).toBeNull();
    expect(
      parse(
        validProfile({
          essentials: { ...validProfile().essentials, preferredAreas: ["a", "a"] },
        }),
      ),
    ).toBeNull();
  });

  it("rejects over-long strings and invalid timestamps", () => {
    expect(parse(validProfile({ note: "x".repeat(501) }))).toBeNull();
    expect(parse(validProfile({ preferredLanguage: "x".repeat(61) }))).toBeNull();
    expect(parse(validProfile({ preferredLanguage: "" }))).toBeNull();
    expect(parse(validProfile({ confirmedAt: "whenever" }))).toBeNull();
  });

  it("rejects an oversized payload before parsing it", () => {
    const oversized = validProfile({ note: "x".repeat(400) });
    const padded = { ...oversized, essentials: { ...oversized.essentials } } as Record<
      string,
      unknown
    >;
    // Inflate beyond the ceiling with a legitimate-looking but huge value.
    padded.note = "x".repeat(MAX_PROFILE_PAYLOAD_BYTES + 10);
    expect(parseStoredProfileV2(padded)).toBeNull();
  });

  it("rejects non-object payloads and unknown versions", () => {
    expect(parseStoredProfileV2(null)).toBeNull();
    expect(parseStoredProfileV2("{}")).toBeNull();
    expect(parseStoredProfileV2(42)).toBeNull();
    expect(parse(validProfile({ profileVersion: 1 as never }))).toBeNull();
    expect(parse(validProfile({ profileVersion: 3 as never }))).toBeNull();
  });
});

describe("Full-flow purchase purpose derivation", () => {
  it("derives investment from an investment motivation or goal", () => {
    expect(derivePurchasePurpose({ motivations: ["investment"], goals: [] })).toBe("investment");
    expect(derivePurchasePurpose({ motivations: [], goals: ["rental_income"] })).toBe("investment");
    expect(derivePurchasePurpose({ motivations: [], goals: ["financial_security"] })).toBe(
      "investment",
    );
  });

  it("derives lifestyle from purely lifestyle answers", () => {
    expect(derivePurchasePurpose({ motivations: ["second_home"], goals: ["peace_privacy"] })).toBe(
      "lifestyle",
    );
  });

  it("derives both when the answers carry each signal", () => {
    expect(
      derivePurchasePurpose({ motivations: ["investment", "family"], goals: ["rental_income"] }),
    ).toBe("both");
    expect(derivePurchasePurpose({ motivations: ["second_home"], goals: ["rental_income"] })).toBe(
      "both",
    );
  });

  it("derives exploring only when there is genuinely no evidence", () => {
    expect(derivePurchasePurpose({ motivations: [], goals: [] })).toBe("exploring");
  });
});
