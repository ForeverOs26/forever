import type {
  IntelligenceInput,
  IntelligenceRecommendation,
  ScoreResult,
} from "../intelligence-types";

export function getStrengths(
  input: IntelligenceInput,
  scores: Record<string, ScoreResult>,
): IntelligenceRecommendation[] {
  const fields = input.fields;
  const strengths: IntelligenceRecommendation[] = [];

  if (fields.foreverVerified && fields.trustScore >= 8) {
    strengths.push({
      title: "Strong verification profile",
      summary: "Forever verification and a high trust score support buyer confidence.",
      sourceFields: ["trust.foreverVerified", "trust.trustScore"],
      sourceValues: {
        foreverVerified: fields.foreverVerified,
        trustScore: fields.trustScore,
      },
    });
  }

  if (fields.marketPosition === "Below market" || fields.investmentValue >= 8.5) {
    strengths.push({
      title: "Compelling value position",
      summary: "The project has favorable investment value or market positioning.",
      sourceFields: ["trust.marketPosition", "investment.investmentValue"],
      sourceValues: {
        marketPosition: fields.marketPosition,
        investmentValue: fields.investmentValue,
      },
    });
  }

  if (fields.rentalDemand === "Very High" || fields.rentalDemand === "High") {
    strengths.push({
      title: "Strong rental demand",
      summary: "Rental demand supports income-oriented ownership strategies.",
      sourceFields: ["investment.rentalDemand", "investment.rentalYield"],
      sourceValues: {
        rentalDemand: fields.rentalDemand,
        rentalYieldText: fields.rentalYieldText,
      },
    });
  }

  if (fields.distanceToBeachMeters !== null && fields.distanceToBeachMeters <= 1000) {
    strengths.push({
      title: "Close beach access",
      summary: "Beach proximity improves lifestyle appeal and rental positioning.",
      sourceFields: ["location.distanceToBeach"],
      sourceValues: {
        distanceToBeachText: fields.distanceToBeachText,
        distanceToBeachMeters: fields.distanceToBeachMeters,
      },
    });
  }

  if (scores.location.score >= 75) {
    strengths.push({
      title: "Well-rounded location fundamentals",
      summary: "Location score is supported by nearby amenities and area data.",
      sourceFields: scores.location.sourceFields,
      sourceValues: scores.location.sourceValues,
    });
  }

  return strengths;
}
