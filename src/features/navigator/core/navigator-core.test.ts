import { describe, expect, it } from "vitest";

import {
  BUDGET_OPTIONS,
  CONCERN_OPTIONS,
  NAVIGATOR_SCREEN_ORDER,
  SUCCESS_OPTIONS,
  TIMELINE_OPTIONS,
  WHY_PHUKET_OPTIONS,
  buildForeverStory,
  buildRecommendationPath,
  canContinue,
  deriveDecisionProfile,
  emptyAnswers,
  type NavigatorAnswers,
} from "./index";

function fullAnswers(): NavigatorAnswers {
  return {
    motivations: ["investment", "second_home"],
    goals: ["rental_income"],
    budget: "500k_1m",
    timeline: "6_12m",
    concerns: ["ownership"],
    note: "Prefers west coast",
  };
}

describe("NAV-001 screen order", () => {
  it("preserves the approved 00–08 order", () => {
    expect(NAVIGATOR_SCREEN_ORDER).toEqual([
      "welcome",
      "why_phuket",
      "success",
      "budget_timeline",
      "concern",
      "forever_story",
      "recommendation",
      "advisor",
      "confirmation",
    ]);
  });
});

describe("approved NAV-001 questions and options", () => {
  it("keeps the approved keys and labels (no replacement questionnaire)", () => {
    expect(WHY_PHUKET_OPTIONS.map((o) => o.key)).toEqual([
      "second_home",
      "retirement",
      "investment",
      "asia_base",
      "slower_life",
      "family",
    ]);
    expect(SUCCESS_OPTIONS).toHaveLength(6);
    expect(BUDGET_OPTIONS.map((o) => o.key)).toContain("exploring");
    expect(TIMELINE_OPTIONS.map((o) => o.key)).toEqual([
      "ready_now",
      "3_6m",
      "6_12m",
      "exploring",
    ]);
    expect(CONCERN_OPTIONS.map((o) => o.label)).toContain("Legal & ownership rules");
  });

  it("does not introduce area / bedroom / property-type / new timing questions", () => {
    const allKeys = [
      ...WHY_PHUKET_OPTIONS,
      ...SUCCESS_OPTIONS,
      ...CONCERN_OPTIONS,
    ].map((o) => o.key);
    expect(allKeys).not.toContain("bedrooms");
    expect(allKeys).not.toContain("property_type");
    expect(allKeys).not.toContain("area");
  });
});

describe("continue gating", () => {
  it("gates each counted question on its own rule", () => {
    const answers = emptyAnswers();
    expect(canContinue("why_phuket", answers)).toBe(false);
    expect(canContinue("why_phuket", { ...answers, motivations: ["family"] })).toBe(true);
    expect(canContinue("budget_timeline", { ...answers, budget: "500k_1m" })).toBe(false);
    expect(
      canContinue("budget_timeline", { ...answers, budget: "500k_1m", timeline: "ready_now" }),
    ).toBe(true);
  });
});

describe("shared derivations are deterministic (mode parity)", () => {
  it("identical answers produce an identical DecisionProfile", () => {
    // Both shells call this same pure function, so identical answers => identical
    // profile regardless of mode.
    const a = fullAnswers();
    const b = fullAnswers();
    expect(deriveDecisionProfile(a)).toEqual(deriveDecisionProfile(b));
  });

  it("identical answers produce an identical Forever Story", () => {
    expect(buildForeverStory(fullAnswers())).toEqual(buildForeverStory(fullAnswers()));
  });

  it("identical answers produce an identical recommendation path", () => {
    expect(buildRecommendationPath(fullAnswers())).toEqual(
      buildRecommendationPath(fullAnswers()),
    );
  });
});

describe("editing an answer recalculates downstream state", () => {
  it("changes DecisionProfile, Story, and recommendation when an answer changes", () => {
    const base = fullAnswers();
    const edited: NavigatorAnswers = { ...base, goals: ["peace_privacy"], motivations: ["retirement"] };

    expect(deriveDecisionProfile(edited)).not.toEqual(deriveDecisionProfile(base));
    expect(buildForeverStory(edited)).not.toEqual(buildForeverStory(base));
    // Investment branch vs lifestyle branch differ.
    expect(buildRecommendationPath(edited).primaryRecommendation).not.toBe(
      buildRecommendationPath(base).primaryRecommendation,
    );
  });

  it("marks incomplete profiles and falls back to the default story", () => {
    const partial = { ...emptyAnswers(), motivations: ["family"] as const };
    expect(deriveDecisionProfile(partial).isComplete).toBe(false);
    expect(buildForeverStory(partial).profileLabel).toBe("The Considered Retreat-Seeker");
  });
});
