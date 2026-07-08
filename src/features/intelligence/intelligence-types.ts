import type { ProjectDetail } from "@/features/project-detail/project-detail-types";

export type ForeverVerdict =
  | "Strong Buy"
  | "Excellent Long-Term Investment"
  | "Ideal Family Residence"
  | "Lifestyle Purchase"
  | "Wait for Better Pricing";

export type IntelligenceSourceValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[];

export type IntelligenceEvidence = {
  sourceFields: string[];
  sourceValues: Record<string, IntelligenceSourceValue>;
};

export type ScoreBand = "excellent" | "strong" | "fair" | "weak" | "unknown";

export type ScoreResult = IntelligenceEvidence & {
  key: string;
  label: string;
  score: number;
  maxScore: 100;
  band: ScoreBand;
  summary: string;
};

export type IntelligenceRecommendation = IntelligenceEvidence & {
  title: string;
  summary: string;
  severity?: "low" | "medium" | "high";
};

export type IntelligenceInput = {
  project: ProjectDetail;
  fields: {
    slug: string;
    name: string;
    projectType: string;
    salesStatus: string;
    constructionStatus: string;
    ownershipType: string;
    locationArea: string;
    startingPriceTHB: number;
    priceRange: string;
    pricePerSqm: string;
    verifiedPrice: string;
    promotion: string;
    foreverVerified: boolean;
    trustScore: number;
    trustNote: string;
    marketPosition: string;
    existingVerdict: string;
    lastInspection: string;
    investmentValue: number;
    rentalYieldText: string;
    rentalYieldPercent: number | null;
    rentalDemand: string;
    capitalGrowthEstimate: string;
    capitalGrowthPercent: number | null;
    distanceToBeachText: string;
    distanceToBeachMeters: number | null;
    distanceToAirportText: string;
    nearbySchoolsCount: number;
    nearbyHospitalsCount: number;
    lifestyleCount: number;
    unitCount: number;
    availableUnitCount: number;
    soldUnitCount: number;
    hasHeroImage: boolean;
    galleryCount: number;
    floorPlanCount: number;
    documentCount: number;
    developerName: string;
    developerDescription: string;
    investmentRowsCount: number;
    averageOccupancyRate: number | null;
    averageAnnualRoiPercent: number | null;
    hasRentalGuarantee: boolean;
  };
};

export type ForeverIntelligenceReport = {
  verdict: ForeverVerdict;
  totalScore: number;
  scores: {
    trust: ScoreResult;
    investment: ScoreResult;
    rental: ScoreResult;
    location: ScoreResult;
    liquidity: ScoreResult;
    constructionRisk: ScoreResult;
  };
  strengths: IntelligenceRecommendation[];
  weaknesses: IntelligenceRecommendation[];
  risks: IntelligenceRecommendation[];
  bestBuyerProfile: IntelligenceRecommendation;
  rentalStrategy: IntelligenceRecommendation;
  exitStrategy: IntelligenceRecommendation;
  investmentHorizon: IntelligenceRecommendation;
};
