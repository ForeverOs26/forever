import type { IntelligenceInput, IntelligenceRecommendation } from "../intelligence-types";

export function getRisks(input: IntelligenceInput): IntelligenceRecommendation[] {
  const fields = input.fields;
  const risks: IntelligenceRecommendation[] = [];

  if (fields.constructionStatus === "Planning" || fields.constructionStatus === "Pre-Launch") {
    risks.push({
      title: "Early-stage construction risk",
      summary: "Earlier project stages carry greater delivery and timeline uncertainty.",
      severity: "high",
      sourceFields: ["core.constructionStatus"],
      sourceValues: {
        constructionStatus: fields.constructionStatus,
      },
    });
  }

  if (!fields.lastInspection) {
    risks.push({
      title: "No recent inspection date",
      summary: "Missing inspection data reduces traceability of current site condition.",
      severity: "medium",
      sourceFields: ["trust.lastInspection"],
      sourceValues: {
        lastInspection: fields.lastInspection,
      },
    });
  }

  if (fields.marketPosition === "Slight premium") {
    risks.push({
      title: "Premium pricing risk",
      summary: "A premium market position may limit upside if resale conditions soften.",
      severity: "medium",
      sourceFields: ["trust.marketPosition", "pricing.pricePerSqm"],
      sourceValues: {
        marketPosition: fields.marketPosition,
        pricePerSqm: fields.pricePerSqm,
      },
    });
  }

  if (fields.salesStatus === "Sold Out" || fields.availableUnitCount === 0 && fields.unitCount > 0) {
    risks.push({
      title: "Limited inventory access",
      summary: "Availability constraints may reduce buyer choice and negotiation leverage.",
      severity: "low",
      sourceFields: ["core.status", "units.availabilityStatus"],
      sourceValues: {
        salesStatus: fields.salesStatus,
        unitCount: fields.unitCount,
        availableUnitCount: fields.availableUnitCount,
      },
    });
  }

  return risks;
}
