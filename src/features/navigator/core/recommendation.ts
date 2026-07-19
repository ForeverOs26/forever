/**
 * RecommendationPath — the deterministic guidance branch.
 *
 * This is NAV-001's approved recommendation logic (moved verbatim from
 * NavigatorFlow.tsx). It produces the guidance copy and the investment-profile
 * string that feeds the advisor summary. It is shared by both shells:
 *   • the website renders it as the guidance / advisor-invitation screens;
 *   • the booth reuses its investment profile in the advisor/lead handoff.
 *
 * It never claims a "best project", a score, or a percentage. The booth's
 * catalogue results come from the separate deterministic match evaluator, not
 * from this guidance branch.
 */

import { isProfileComplete, type NavigatorAnswers } from "./decision-profile";

export interface RecommendationPath {
  primaryRecommendation: string;
  whyItFits: string;
  investmentProfile: string;
}

export const DEFAULT_RECOMMENDATION_PATH: RecommendationPath = {
  primaryRecommendation: "A source-backed Phuket project shortlist",
  whyItFits:
    "You are still shaping the decision, so the right first step is a calm shortlist that compares ownership clarity, area fit, budget comfort, and long-term confidence before narrowing to a specific project type.",
  investmentProfile:
    "Balanced explorer: needs clarity before commitment, with room to compare lifestyle and investment tradeoffs.",
};

export function buildRecommendationPath(answers: NavigatorAnswers): RecommendationPath {
  if (!isProfileComplete(answers)) {
    return DEFAULT_RECOMMENDATION_PATH;
  }

  const { motivations, goals, budget, timeline } = answers;

  if (goals.includes("rental_income") || motivations.includes("investment")) {
    return {
      primaryRecommendation: "Rental-ready residences with professional management",
      whyItFits:
        "Your answers point toward income discipline and easier remote ownership. A managed residence gives you clearer operating assumptions before you compare individual projects.",
      investmentProfile:
        timeline === "ready_now" || timeline === "3_6m"
          ? "Yield-aware investor: ready to compare recorded rental assumptions and near-term availability."
          : "Patient income planner: focused on rental logic, but still needs time to compare areas and management quality.",
    };
  }

  if (
    goals.includes("peace_privacy") ||
    motivations.includes("slower_life") ||
    motivations.includes("retirement")
  ) {
    return {
      primaryRecommendation: "Private low-density villas in established lifestyle areas",
      whyItFits:
        "You are optimizing for calm, privacy, and a decision you can live with. A low-density villa path keeps the search focused on comfort, ownership clarity, and day-to-day livability.",
      investmentProfile:
        budget === "lt_250k" || budget === "250_500k"
          ? "Lifestyle-led buyer: careful on budget, with fit and clarity carrying more weight than maximum yield."
          : "Lifestyle-led capital preserver: values privacy, quality, and long holding confidence.",
    };
  }

  if (goals.includes("legacy") || motivations.includes("family")) {
    return {
      primaryRecommendation: "Family-sized residences with long-hold fundamentals",
      whyItFits:
        "Your answers suggest the property needs to work for more than one trip or one season. The first screen should favor space, durability, area convenience, and future flexibility.",
      investmentProfile:
        "Long-hold family allocator: prioritizes reliability, usable space, and a decision that remains sensible over time.",
    };
  }

  return DEFAULT_RECOMMENDATION_PATH;
}
