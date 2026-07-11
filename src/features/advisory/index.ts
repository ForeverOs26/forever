/**
 * Forever Advisory Workspace RC1 — public API.
 *
 * This is the single entry point Codex should import from. It exposes:
 *  - the root component
 *  - the sub-components (for advanced composition)
 *  - all public types
 *  - the deterministic demo data + action catalogue
 *
 * There are no default exports and no name collisions: components are named
 * for their concept, data types carry `Data` / domain suffixes.
 */

export { AdvisoryWorkspace } from "./AdvisoryWorkspace";

export {
  ClientSnapshot,
  RecommendedProjects,
  AdvisorStrategy,
  RiskPanel,
  InvestmentIntelligence,
  RentalIntelligence,
  LocationIntelligence,
  ForeverPassport,
  ProjectSummary,
  ProjectComparison,
  ProjectRecommendations,
  NextAction,
} from "./components";

export type {
  ClientSnapshotProps,
  RecommendedProjectsProps,
  AdvisorStrategyProps,
  RiskPanelProps,
  InvestmentIntelligenceProps,
  RentalIntelligenceProps,
  LocationIntelligenceProps,
  ForeverPassportProps,
  ProjectSummaryProps,
  ProjectComparisonProps,
  ProjectRecommendationsProps,
  NextActionProps,
} from "./components";

export { ADVISORY_ACTIONS } from "./mock";
export { mapProjectToAdvisorySession } from "./project-adapter";
export {
  deriveInvestmentIntelligence,
  NOT_AVAILABLE,
  INVESTMENT_SCORE_UNAVAILABLE,
} from "./investment-intelligence";
export type {
  InvestmentIntelligence as InvestmentIntelligenceData,
  InvestmentReadinessVerdict,
  InvestmentReadinessSignals,
} from "./investment-intelligence";
export { deriveRentalIntelligence, RENTAL_SCORE_UNAVAILABLE } from "./rental-intelligence";
export type {
  RentalIntelligence as RentalIntelligenceData,
  RentalReadinessVerdict,
  RentalReadinessSignals,
} from "./rental-intelligence";
export { deriveLocationIntelligence, LOCATION_SCORE_UNAVAILABLE } from "./location-intelligence";
export type {
  LocationIntelligence as LocationIntelligenceData,
  LocationReadinessVerdict,
  LocationReadinessSignals,
  LocationIntelligenceSources,
} from "./location-intelligence";
export { deriveForeverPassport } from "./forever-passport";
export type {
  ForeverPassport as ForeverPassportData,
  DeriveForeverPassportOptions,
  PassportReadinessVerdict,
  PassportFoundationKey,
  PassportProjectIdentity,
  PassportTrustSummary,
  PassportTrustSignals,
  PassportInvestmentSummary,
  PassportRentalSummary,
  PassportLocationSummary,
  PassportDataCompleteness,
  PassportCompletenessRow,
  PassportCombinedGaps,
  PassportOverallVerdict,
  PassportVerdictRow,
  PassportEvidenceCoverage,
  PassportEvidenceRow,
  PassportMetadata,
} from "./forever-passport";
export { deriveProjectSummary } from "./project-summary";
export type {
  ProjectSummary as ProjectSummaryData,
  DeriveProjectSummaryInput,
  ProjectSummaryDomainKey,
  ProjectSummarySignal,
  ProjectSummaryOverview,
  ProjectSummaryFact,
  ProjectSummaryBuyerProfile,
  ProjectSummaryReadiness,
  ProjectSummaryMetadata,
} from "./project-summary";
export { deriveProjectComparison } from "./project-comparison";
export type {
  ProjectComparison as ProjectComparisonData,
  DeriveProjectComparisonInput,
  ComparisonProjectInput,
  ComparisonSide,
  ComparisonLead,
  ComparisonRow,
  ComparisonRowStatus,
  ComparisonSetDiff,
  ComparisonProjectIdentity,
  ComparedProjects,
  ComparisonHeadline,
  PassportComparison,
  DomainComparison,
  BuyerProfileComparison,
  ReadinessComparison,
  EvidenceCompletenessRow,
  EvidenceCompletenessComparison,
  ProjectComparisonMetadata,
} from "./project-comparison";
export { deriveProjectRecommendations } from "./project-recommendations";
export type {
  ProjectRecommendations as ProjectRecommendationsData,
  DeriveProjectRecommendationsInput,
  RecommendationCandidateInput,
  RecommendationCoverage,
  RecommendationSuitability,
  ProjectRecommendationEntry,
  RecommendationTop,
  ProjectRecommendationsHeadline,
  ProjectRecommendationsMetadata,
} from "./project-recommendations";

export type {
  // Enumerations
  BuyerType,
  ClientTimeline,
  RiskProfile,
  ConfidenceLevel,
  RiskSeverity,
  RiskScope,
  AdvisoryActionId,
  // Data shapes
  ClientSnapshotData,
  RecommendedProject,
  AdvisorStrategyData,
  AdvisoryRisk,
  AdvisoryAction,
  AdvisorySession,
  // Component props
  AdvisoryWorkspaceProps,
} from "./types";
