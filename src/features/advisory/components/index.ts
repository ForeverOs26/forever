/**
 * Barrel for the advisory sub-components. Re-exports both the components and
 * their prop types. Component names and data-type names never collide because
 * data types live in `../types` with `Data` / domain suffixes.
 */

export { ClientSnapshot } from "./ClientSnapshot";
export type { ClientSnapshotProps } from "./ClientSnapshot";

export { RecommendedProjects } from "./RecommendedProjects";
export type { RecommendedProjectsProps } from "./RecommendedProjects";

export { AdvisorStrategy } from "./AdvisorStrategy";
export type { AdvisorStrategyProps } from "./AdvisorStrategy";

export { RiskPanel } from "./RiskPanel";
export type { RiskPanelProps } from "./RiskPanel";

export { InvestmentIntelligence } from "./InvestmentIntelligence";
export type { InvestmentIntelligenceProps } from "./InvestmentIntelligence";

export { RentalIntelligence } from "./RentalIntelligence";
export type { RentalIntelligenceProps } from "./RentalIntelligence";

export { LocationIntelligence } from "./LocationIntelligence";
export type { LocationIntelligenceProps } from "./LocationIntelligence";

export { ForeverPassport } from "./ForeverPassport";
export type { ForeverPassportProps } from "./ForeverPassport";

export { ProjectSummary } from "./ProjectSummary";
export type { ProjectSummaryProps } from "./ProjectSummary";

export { ProjectComparison } from "./ProjectComparison";
export type { ProjectComparisonProps } from "./ProjectComparison";

export { ProjectRecommendations } from "./ProjectRecommendations";
export type { ProjectRecommendationsProps } from "./ProjectRecommendations";

export { NextAction } from "./NextAction";
export type { NextActionProps } from "./NextAction";
