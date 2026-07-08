import type {
  ForeverIntelligenceReport,
  IntelligenceInput,
  IntelligenceRecommendation,
} from "./intelligence-types";
import { createIntelligenceInput } from "./intelligence-input";
import { scoreConstructionRisk } from "./scoring/construction-risk-score";
import { scoreInvestment } from "./scoring/investment-score";
import { scoreLiquidity } from "./scoring/liquidity-score";
import { scoreLocation } from "./scoring/location-score";
import { scoreRental } from "./scoring/rental-score";
import { scoreTrust } from "./scoring/trust-score";
import { getRisks } from "./rules/risks";
import { getStrengths } from "./rules/strengths";
import { getWeaknesses } from "./rules/weaknesses";
import { calculateTotalScore, getForeverVerdict } from "./verdict";
import type { ProjectDetail } from "@/features/project-detail/project-detail-types";

function getBestBuyerProfile(input: IntelligenceInput): IntelligenceRecommendation {
  const fields = input.fields;

  if (fields.nearbySchoolsCount > 0 && fields.projectType === "Villa") {
    return {
      title: "Family residence buyer",
      summary: "Best suited to family buyers seeking space, school access, and long-term lifestyle use.",
      sourceFields: ["core.type", "location.nearbySchools", "core.location"],
      sourceValues: {
        projectType: fields.projectType,
        nearbySchoolsCount: fields.nearbySchoolsCount,
        locationArea: fields.locationArea,
      },
    };
  }

  if (fields.rentalDemand === "Very High" || fields.rentalDemand === "High") {
    return {
      title: "Yield-focused investor",
      summary: "Best suited to investors prioritizing rental demand and income positioning.",
      sourceFields: ["investment.rentalDemand", "investment.rentalYield"],
      sourceValues: {
        rentalDemand: fields.rentalDemand,
        rentalYieldText: fields.rentalYieldText,
      },
    };
  }

  return {
    title: "Lifestyle-led buyer",
    summary: "Best suited to buyers prioritizing project quality, location, and personal use.",
    sourceFields: ["core.type", "core.location", "trust.trustScore"],
    sourceValues: {
      projectType: fields.projectType,
      locationArea: fields.locationArea,
      trustScore: fields.trustScore,
    },
  };
}

function getRentalStrategy(input: IntelligenceInput): IntelligenceRecommendation {
  const fields = input.fields;

  if (fields.hasRentalGuarantee) {
    return {
      title: "Use guaranteed rental period first",
      summary: "A structured rental guarantee supports predictable early ownership income.",
      sourceFields: ["units.rentalGuarantee"],
      sourceValues: {
        hasRentalGuarantee: fields.hasRentalGuarantee,
      },
    };
  }

  if (fields.rentalDemand === "Very High" || fields.distanceToBeachMeters !== null && fields.distanceToBeachMeters <= 800) {
    return {
      title: "Short-stay premium rental strategy",
      summary: "High demand or close beach access supports a short-stay rental positioning.",
      sourceFields: ["investment.rentalDemand", "location.distanceToBeach"],
      sourceValues: {
        rentalDemand: fields.rentalDemand,
        distanceToBeachMeters: fields.distanceToBeachMeters,
        distanceToBeachText: fields.distanceToBeachText,
      },
    };
  }

  return {
    title: "Balanced long-stay rental strategy",
    summary: "Available data supports a conservative long-stay or mixed-use rental approach.",
    sourceFields: ["investment.rentalDemand", "investment.rentalYield"],
    sourceValues: {
      rentalDemand: fields.rentalDemand,
      rentalYieldText: fields.rentalYieldText,
    },
  };
}

function getExitStrategy(input: IntelligenceInput): IntelligenceRecommendation {
  const fields = input.fields;

  if (fields.rentalDemand === "Very High" || fields.rentalDemand === "High") {
    return {
      title: "Resell with income history",
      summary: "Build a rental record before resale to support investor-facing exit value.",
      sourceFields: ["investment.rentalDemand", "investment.rentalYield"],
      sourceValues: {
        rentalDemand: fields.rentalDemand,
        rentalYieldText: fields.rentalYieldText,
      },
    };
  }

  if (fields.marketPosition === "Below market") {
    return {
      title: "Exit after market repricing",
      summary: "Below-market positioning supports holding until comparable resale prices reset upward.",
      sourceFields: ["trust.marketPosition", "investment.capitalGrowthEstimate"],
      sourceValues: {
        marketPosition: fields.marketPosition,
        capitalGrowthEstimate: fields.capitalGrowthEstimate,
      },
    };
  }

  return {
    title: "Lifestyle-led resale",
    summary: "Exit strategy should emphasize location, project quality, and buyer-fit rather than pure yield.",
    sourceFields: ["core.location", "core.type", "trust.marketPosition"],
    sourceValues: {
      locationArea: fields.locationArea,
      projectType: fields.projectType,
      marketPosition: fields.marketPosition,
    },
  };
}

function getInvestmentHorizon(input: IntelligenceInput): IntelligenceRecommendation {
  const fields = input.fields;

  if (fields.constructionStatus === "Planning" || fields.constructionStatus === "Pre-Launch") {
    return {
      title: "5-7 year horizon",
      summary: "Earlier-stage projects need a longer hold to absorb delivery risk and capture appreciation.",
      sourceFields: ["core.constructionStatus", "investment.capitalGrowthEstimate"],
      sourceValues: {
        constructionStatus: fields.constructionStatus,
        capitalGrowthEstimate: fields.capitalGrowthEstimate,
      },
    };
  }

  if (fields.constructionStatus === "Ready" || fields.rentalDemand === "Very High") {
    return {
      title: "3-5 year horizon",
      summary: "Ready inventory or very high rental demand supports a medium-term investment horizon.",
      sourceFields: ["core.constructionStatus", "investment.rentalDemand"],
      sourceValues: {
        constructionStatus: fields.constructionStatus,
        rentalDemand: fields.rentalDemand,
      },
    };
  }

  return {
    title: "4-6 year horizon",
    summary: "A balanced hold period allows rental evidence and area fundamentals to mature.",
    sourceFields: ["core.constructionStatus", "investment.capitalGrowthEstimate"],
    sourceValues: {
      constructionStatus: fields.constructionStatus,
      capitalGrowthEstimate: fields.capitalGrowthEstimate,
    },
  };
}

export function generateForeverIntelligenceReport(
  project: ProjectDetail,
): ForeverIntelligenceReport {
  const input = createIntelligenceInput(project);
  const scores = {
    trust: scoreTrust(input),
    investment: scoreInvestment(input),
    rental: scoreRental(input),
    location: scoreLocation(input),
    liquidity: scoreLiquidity(input),
    constructionRisk: scoreConstructionRisk(input),
  };
  const totalScore = calculateTotalScore(scores);

  return {
    verdict: getForeverVerdict(totalScore),
    totalScore,
    scores,
    strengths: getStrengths(input, scores),
    weaknesses: getWeaknesses(input),
    risks: getRisks(input),
    bestBuyerProfile: getBestBuyerProfile(input),
    rentalStrategy: getRentalStrategy(input),
    exitStrategy: getExitStrategy(input),
    investmentHorizon: getInvestmentHorizon(input),
  };
}
