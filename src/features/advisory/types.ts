/**
 * Forever Advisory Workspace RC1 — Type definitions.
 *
 * All types are UI-facing contracts consumed via props. There is no coupling
 * to any data source: the workspace is a controlled, presentational module.
 * Data-carrying types are suffixed `Data` / prefixed to avoid colliding with
 * component names of the same concept (e.g. `ClientSnapshotData` vs the
 * `ClientSnapshot` component).
 *
 * The one exception is the optional, pre-derived `InvestmentIntelligence` view
 * model (itself a plain data shape) surfaced on `AdvisoryWorkspaceProps`.
 */

import type { InvestmentIntelligence } from "./investment-intelligence";
import type { RentalIntelligence } from "./rental-intelligence";
import type { LocationIntelligence } from "./location-intelligence";
import type { ForeverPassport } from "./forever-passport";
import type { ProjectSummary } from "./project-summary";

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
  clientName: string | null;
  buyerType: BuyerType | null;
  primaryGoal: string | null;
  budget: string | null;
  timeline: ClientTimeline | null;
  riskProfile: RiskProfile | null;
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
  matchScore: number | null;
  /** The single strongest reason to recommend this project. */
  primaryReason: string | null;
  /** The single most relevant trade-off to disclose. */
  tradeOff: string | null;
  confidence: ConfidenceLevel | null;
  /** Marks clearly-labelled placeholder / demo entries. */
  isPlaceholder?: boolean;
}

/**
 * Private, advisor-only guidance for running the consultation.
 * Rendered by the `AdvisorStrategy` component.
 */
export interface AdvisorStrategyData {
  discussFirst: string | null;
  avoidLeadingWith: string | null;
  /** `id` of the project to present first (matches a `RecommendedProject.id`). */
  showFirstProjectId: string;
  mustClarify: string | null;
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
  /**
   * Optional, pre-derived Forever Passport for the loaded project. When present,
   * the workspace renders it as the executive-summary section at the top of the
   * workspace, aggregating the intelligence foundations. When absent, the
   * section is simply not rendered.
   */
  passport?: ForeverPassport;
  /**
   * Optional, pre-derived Project Summary for the loaded project. When present,
   * the workspace renders it as the concise executive summary directly beneath
   * the Forever Passport and above the detailed Intelligence foundations. When
   * absent, the section is simply not rendered and existing behaviour is
   * unchanged.
   */
  projectSummary?: ProjectSummary;
  /**
   * Optional, pre-derived Investment Intelligence for the loaded project.
   * When present, the workspace renders the Investment Intelligence section
   * without removing or altering any existing section. When absent, the
   * section is simply not rendered.
   */
  investmentIntelligence?: InvestmentIntelligence;
  /**
   * Optional, pre-derived Rental Intelligence for the loaded project. When
   * present, the workspace renders the Rental Intelligence section without
   * removing or altering any existing section. When absent, the section is
   * simply not rendered.
   */
  rentalIntelligence?: RentalIntelligence;
  /**
   * Optional, pre-derived Location Intelligence for the loaded project. When
   * present, the workspace renders the Location Intelligence section without
   * removing or altering any existing section. When absent, the section is
   * simply not rendered.
   */
  locationIntelligence?: LocationIntelligence;
  /** Actions to render in the Next Action panel. */
  actions?: AdvisoryAction[];
  /** Emitted when the advisor selects an action. */
  onAction?: (actionId: AdvisoryActionId) => void;
  /** Optional heading override for embedding contexts. */
  title?: string;
  /** Optional extra classes on the root element. */
  className?: string;
}
