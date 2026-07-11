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
  NextAction,
} from "./components";

export type {
  ClientSnapshotProps,
  RecommendedProjectsProps,
  AdvisorStrategyProps,
  RiskPanelProps,
  InvestmentIntelligenceProps,
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
