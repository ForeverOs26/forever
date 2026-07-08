import type {
  ForeverIntelligenceReport,
  IntelligenceEvidence,
  IntelligenceSourceValue,
  ScoreBand,
} from "@/features/intelligence/intelligence-types";

export type PassportRenderTarget =
  | "website"
  | "tablet-mode"
  | "crm"
  | "pdf"
  | "investor-report"
  | "mobile-app";

export type PassportSectionKey =
  | "identity"
  | "verdict"
  | "scores"
  | "buyer-fit"
  | "recommendation"
  | "risks"
  | "verification";

export type PassportSection = IntelligenceEvidence & {
  key: PassportSectionKey;
  title: string;
  summary: string;
  items: PassportSectionItem[];
};

export type PassportSectionItem = IntelligenceEvidence & {
  label: string;
  value: IntelligenceSourceValue;
  note?: string;
};

export type PassportTimelineEventType =
  | "verified"
  | "inspection"
  | "price-update"
  | "passport-generated";

export type PassportTimelineEvent = IntelligenceEvidence & {
  type: PassportTimelineEventType;
  label: string;
  date: string;
  note?: string;
};

export type PassportTimeline = {
  events: PassportTimelineEvent[];
};

export type PassportMetadata = {
  schemaVersion: "1.0";
  passportVersion: "1.0";
  generatedAt: string;
  source: "project-detail-and-intelligence-report";
  sourceProjectSlug: string;
  supportedRenderTargets: PassportRenderTarget[];
};

export type PassportScore = IntelligenceEvidence & {
  label: string;
  score: number;
  maxScore: 100;
  band: ScoreBand;
  summary: string;
};

export type PassportVerificationDates = {
  lastInspection: string;
  lastPriceUpdate: string;
};

export type ForeverPassport = {
  foreverId: string;
  projectName: string;
  projectSlug: string;
  overallScore: number;
  verdict: ForeverIntelligenceReport["verdict"];
  trust: PassportScore;
  investment: PassportScore;
  rental: PassportScore;
  liquidity: PassportScore;
  construction: PassportScore;
  bestBuyerProfile: PassportSectionItem;
  recommendationSummary: PassportSection;
  risksSummary: PassportSection;
  verificationDates: PassportVerificationDates;
  lastInspection: string;
  lastPriceUpdate: string;
  sections: PassportSection[];
  timeline: PassportTimeline;
  metadata: PassportMetadata;
};

export type SerializedForeverPassport = {
  metadata: PassportMetadata & {
    serializedAt: string;
    renderTarget?: PassportRenderTarget;
  };
  passport: ForeverPassport;
};
