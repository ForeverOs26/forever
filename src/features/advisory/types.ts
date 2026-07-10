/**
 * Forever Advisory Workspace RC1 — Type definitions.
 *
 * All types are UI-facing contracts consumed via props. There is no coupling
 * to any data source: the workspace is a controlled, presentational module.
 * Data-carrying types are suffixed `Data` / prefixed to avoid colliding with
 * component names of the same concept (e.g. `ClientSnapshotData` vs the
 * `ClientSnapshot` component).
 */

/** Buyer archetype used to frame the whole consultation. */
export type BuyerType = "First-time buyer" | "Investor" | "Upgrader" | "Relocating" | "Second home";

/** Client's stated timeline horizon. */
export type ClientTimeline = "Immediate" | "3-6 months" | "6-12 months" | "12+ months";

/** Client's risk appetite. */
export type RiskProfile = "Conservative" | "Balanced" | "Growth-seeking";

/** How sure the advisor should be about a given recommendation. */
export type ConfidenceLevel = "High" | "Medium" | "Low";

/** Severity used across the risk panel. Ordered low → high. */
export type RiskSeverity = "info" | "attention" | "critical";

/** Which layer of the engagement a risk originates from. */
export type RiskScope = "client" | "project" | "data";

/**
 * Snapshot of the client the advisor is about to meet.
 * Rendered by the `ClientSnapshot` component.
 */
export interface ClientSnapshotData {
  clientName: string;
  buyerType: BuyerType;
  primaryGoal: string;
  budget: string;
  timeline: ClientTimeline;
  riskProfile: RiskProfile;
  topPriorities: string[];
}

/**
 * A single recommended project.
 * Rendered by the `RecommendedProjects` component.
 */
export interface RecommendedProject {
  id: string;
  name: string;
  /** Match score, 0-100 inclusive. */
  matchScore: number;
  /** The single strongest reason to recommend this project. */
  primaryReason: string;
  /** The single most relevant trade-off to disclose. */
  tradeOff: string;
  confidence: ConfidenceLevel;
  /** Marks clearly-labelled placeholder / demo entries. */
  isPlaceholder?: boolean;
}

/**
 * Private, advisor-only guidance for running the consultation.
 * Rendered by the `AdvisorStrategy` component.
 */
export interface AdvisorStrategyData {
  discussFirst: string;
  avoidLeadingWith: string;
  /** `id` of the project to present first (matches a `RecommendedProject.id`). */
  showFirstProjectId: string;
  mustClarify: string;
  consultationSequence: string[];
}

/**
 * A single risk surfaced to the advisor.
 * Rendered by the `RiskPanel` component.
 */
export interface AdvisoryRisk {
  id: string;
  title: string;
  explanation: string;
  severity: RiskSeverity;
  scope: RiskScope;
}

/** Stable identifiers for every available next action. */
export type AdvisoryActionId =
  | "send-passport"
  | "book-viewing"
  | "compare-projects"
  | "request-missing-info"
  | "schedule-follow-up";

/** A selectable next action. */
export interface AdvisoryAction {
  id: AdvisoryActionId;
  label: string;
  description: string;
}

/**
 * Complete, self-contained data for one advisory session.
 * This is the single object the workspace renders.
 */
export interface AdvisorySession {
  client: ClientSnapshotData;
  recommendations: RecommendedProject[];
  strategy: AdvisorStrategyData;
  risks: AdvisoryRisk[];
}

/** Props for the root `AdvisoryWorkspace` component. */
export interface AdvisoryWorkspaceProps {
  /** Fully-resolved session data. Deterministic; supplied by the host. */
  session: AdvisorySession;
  /** Actions to render in the Next Action panel. */
  actions?: AdvisoryAction[];
  /** Emitted when the advisor selects an action. */
  onAction?: (actionId: AdvisoryActionId) => void;
  /** Optional heading override for embedding contexts. */
  title?: string;
  /** Optional extra classes on the root element. */
  className?: string;
}
