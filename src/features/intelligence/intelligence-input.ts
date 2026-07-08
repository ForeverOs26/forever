import type { ProjectDetail } from "@/features/project-detail/project-detail-types";
import type { IntelligenceInput } from "./intelligence-types";

function parseFirstPercent(value: string): number | null {
  const match = value.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function parseDistanceToMeters(value: string): number | null {
  const normalized = value.toLowerCase();
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(km|m)\b/);
  if (!match) return null;

  const amount = Number(match[1]);
  return match[2] === "km" ? amount * 1000 : amount;
}

function average(values: Array<number | null>): number | null {
  const clean = values.filter((value): value is number => typeof value === "number");
  if (clean.length === 0) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

export function createIntelligenceInput(project: ProjectDetail): IntelligenceInput {
  const units = project.units;
  const availableUnitCount = units.filter((unit) =>
    ["available", "selling"].includes(unit.availabilityStatus.toLowerCase()),
  ).length;
  const soldUnitCount = units.filter((unit) =>
    ["sold", "sold_out", "sold out"].includes(unit.availabilityStatus.toLowerCase()),
  ).length;
  const investmentRows = project.investment.rows;

  return {
    project,
    fields: {
      slug: project.core.slug,
      name: project.core.name,
      projectType: project.core.type,
      salesStatus: project.core.status,
      constructionStatus: project.core.constructionStatus,
      ownershipType: project.core.ownershipType,
      locationArea: project.core.location,
      startingPriceTHB: project.pricing.startingPriceTHB,
      priceRange: project.pricing.priceRange,
      pricePerSqm: project.pricing.pricePerSqm,
      verifiedPrice: project.pricing.verifiedPrice,
      promotion: project.pricing.promotion,
      foreverVerified: project.trust.foreverVerified,
      trustScore: project.trust.trustScore,
      trustNote: project.trust.trustNote,
      marketPosition: project.trust.marketPosition,
      existingVerdict: project.trust.verdict,
      lastInspection: project.trust.lastInspection,
      investmentValue: project.investment.investmentValue,
      rentalYieldText: project.investment.rentalYield,
      rentalYieldPercent: parseFirstPercent(project.investment.rentalYield),
      rentalDemand: project.investment.rentalDemand,
      capitalGrowthEstimate: project.investment.capitalGrowthEstimate,
      capitalGrowthPercent: parseFirstPercent(project.investment.capitalGrowthEstimate),
      distanceToBeachText: project.location.distanceToBeach,
      distanceToBeachMeters: parseDistanceToMeters(project.location.distanceToBeach),
      distanceToAirportText: project.location.distanceToAirport,
      nearbySchoolsCount: project.location.nearbySchools.length,
      nearbyHospitalsCount: project.location.nearbyHospitals.length,
      lifestyleCount: project.location.lifestyle.length,
      unitCount: units.length,
      availableUnitCount,
      soldUnitCount,
      hasHeroImage: Boolean(project.media.hero),
      galleryCount: project.media.gallery.length,
      floorPlanCount: project.media.floorPlans.length,
      documentCount: project.media.documents.length,
      developerName: project.developer?.name ?? "",
      developerDescription: project.developer?.description ?? "",
      investmentRowsCount: investmentRows.length,
      averageOccupancyRate: average(investmentRows.map((row) => row.occupancyRate)),
      averageAnnualRoiPercent: average(investmentRows.map((row) => row.annualRoiPercent)),
      hasRentalGuarantee: units.some((unit) => Boolean(unit.rentalGuarantee)),
    },
  };
}
