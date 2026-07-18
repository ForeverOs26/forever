/**
 * NAV-001 answers and the derived DecisionProfile.
 *
 * `NavigatorAnswers` is the raw, serializable answer set (the same shape both
 * shells collect). `DecisionProfile` is the deterministic derivation used by the
 * Forever Story, the recommendation path, and the project-matching evaluator.
 *
 * Because both website and booth feed the identical answers into
 * `deriveDecisionProfile`, identical answers always produce an identical
 * DecisionProfile regardless of mode.
 */

import type { PropertyType } from "@/lib/data";
import {
  COUNTED_QUESTION_SCREENS,
  budgetLabel,
  type BudgetKey,
  type ConcernKey,
  type GoalKey,
  type MotivationKey,
  type NavigatorScreen,
  type TimelineKey,
} from "./questions";

export interface NavigatorAnswers {
  motivations: MotivationKey[];
  goals: GoalKey[];
  budget: BudgetKey | null;
  timeline: TimelineKey | null;
  concerns: ConcernKey[];
  note: string;
}

export function emptyAnswers(): NavigatorAnswers {
  return {
    motivations: [],
    goals: [],
    budget: null,
    timeline: null,
    concerns: [],
    note: "",
  };
}

/**
 * Approximate USD→THB band boundary used only to compare a NAV-001 budget band
 * against a project's `startingPriceTHB`. It is a matching threshold, never a
 * quoted price — no converted figure is ever shown to a guest.
 */
export const USD_TO_THB = 35;

const BUDGET_CEILING_USD: Record<BudgetKey, number | null> = {
  lt_250k: 250_000,
  "250_500k": 500_000,
  "500k_1m": 1_000_000,
  "1m_2_5m": 2_500_000,
  gt_2_5m: Number.POSITIVE_INFINITY,
  exploring: null, // no budget fact -> no budget-based reason
};

/** Upper THB bound implied by the selected budget band, or null when unknown. */
export function budgetCeilingTHB(budget: BudgetKey | null): number | null {
  if (!budget) return null;
  const usd = BUDGET_CEILING_USD[budget];
  if (usd === null) return null;
  if (usd === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  return usd * USD_TO_THB;
}

/**
 * The derived, structured profile. It carries only facts that actually exist in
 * the confirmed NAV-001 answers.
 *
 * NAV-001 does not collect a preferred area, bedroom count, or property type, so
 * `preferredAreas` and `preferredPropertyTypes` are always empty here. They exist
 * so the matching evaluator lights up honestly if those facts are ever collected,
 * without any mode-specific branch.
 */
export interface DecisionProfile {
  motivations: MotivationKey[];
  goals: GoalKey[];
  budget: BudgetKey | null;
  timeline: TimelineKey | null;
  concerns: ConcernKey[];
  note: string;
  isComplete: boolean;
  budgetCeilingTHB: number | null;
  wantsInvestment: boolean;
  preferredAreas: string[];
  preferredPropertyTypes: PropertyType[];
}

export function isProfileComplete(answers: NavigatorAnswers): boolean {
  return (
    answers.motivations.length > 0 &&
    answers.goals.length > 0 &&
    Boolean(answers.budget) &&
    Boolean(answers.timeline) &&
    answers.concerns.length > 0
  );
}

export function deriveDecisionProfile(answers: NavigatorAnswers): DecisionProfile {
  const wantsInvestment =
    answers.goals.includes("rental_income") ||
    answers.goals.includes("financial_security") ||
    answers.motivations.includes("investment");

  return {
    motivations: [...answers.motivations],
    goals: [...answers.goals],
    budget: answers.budget,
    timeline: answers.timeline,
    concerns: [...answers.concerns],
    note: answers.note,
    isComplete: isProfileComplete(answers),
    budgetCeilingTHB: budgetCeilingTHB(answers.budget),
    wantsInvestment,
    // NAV-001 collects neither of these facts today.
    preferredAreas: [],
    preferredPropertyTypes: [],
  };
}

/** Human-readable budget answer, used by advisor summary and booth lead payload. */
export function budgetAnswerLabel(answers: NavigatorAnswers): string {
  return budgetLabel(answers.budget);
}

/**
 * Continue-gating rule for each counted question screen. Shared so the website
 * and booth "Continue" buttons enable/disable on exactly the same condition.
 */
export function canContinue(screen: NavigatorScreen, answers: NavigatorAnswers): boolean {
  switch (screen) {
    case "why_phuket":
      return answers.motivations.length > 0;
    case "success":
      return answers.goals.length > 0;
    case "budget_timeline":
      return Boolean(answers.budget && answers.timeline);
    case "concern":
      return answers.concerns.length > 0;
    default:
      return true;
  }
}

export const COUNTED_QUESTIONS = COUNTED_QUESTION_SCREENS;
