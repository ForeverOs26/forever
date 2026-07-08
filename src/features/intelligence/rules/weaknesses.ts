import type { IntelligenceInput, IntelligenceRecommendation } from "../intelligence-types";

export function getWeaknesses(input: IntelligenceInput): IntelligenceRecommendation[] {
  const fields = input.fields;
  const weaknesses: IntelligenceRecommendation[] = [];

  if (!fields.verifiedPrice) {
    weaknesses.push({
      title: "Limited verified pricing evidence",
      summary: "The project has no verified price field available for traceable price confidence.",
      severity: "medium",
      sourceFields: ["pricing.verifiedPrice"],
      sourceValues: {
        verifiedPrice: fields.verifiedPrice,
      },
    });
  }

  if (fields.galleryCount < 3) {
    weaknesses.push({
      title: "Limited visual due diligence",
      summary: "The media set is thin, which reduces visual confidence before inspection.",
      severity: "low",
      sourceFields: ["media.gallery"],
      sourceValues: {
        galleryCount: fields.galleryCount,
      },
    });
  }

  if (fields.floorPlanCount === 0) {
    weaknesses.push({
      title: "No floor plans available",
      summary: "Missing floor plans make unit layout and efficiency harder to evaluate.",
      severity: "medium",
      sourceFields: ["media.floorPlans"],
      sourceValues: {
        floorPlanCount: fields.floorPlanCount,
      },
    });
  }

  if (fields.investmentRowsCount === 0 && !fields.rentalYieldText) {
    weaknesses.push({
      title: "Limited rental evidence",
      summary: "Rental assumptions have limited supporting structured investment data.",
      severity: "medium",
      sourceFields: ["investment.rows", "investment.rentalYield"],
      sourceValues: {
        investmentRowsCount: fields.investmentRowsCount,
        rentalYieldText: fields.rentalYieldText,
      },
    });
  }

  return weaknesses;
}
