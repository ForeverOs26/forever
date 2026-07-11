import { NOT_AVAILABLE } from "./investment-intelligence";
import type { InvestmentIntelligence } from "./investment-intelligence";
import type { RentalIntelligence } from "./rental-intelligence";
import type { LocationIntelligence } from "./location-intelligence";
import type { ForeverPassport, PassportReadinessVerdict } from "./forever-passport";
import type { ProjectSummary } from "./project-summary";
import type { ProjectComparison } from "./project-comparison";
import type { ProjectRecommendations } from "./project-recommendations";

/**
 * Forever Client Strategy — composition layer (RC2.9).
 *
 * The Client Strategy is the advisory layer that sits directly above the Advisor
 * Report. It is NOT a new scoring engine, NOT a new intelligence foundation, and
 * NOT a new verdict engine. It is a PURE COMPOSITION layer: it assembles the
 * already-derived Forever Advisory outputs — Forever Passport (RC2.4), Project
 * Summary (RC2.5), the Investment / Rental / Location Intelligence foundations
 * (RC2.1–RC2.3) and, when available, Project Comparison (RC2.6) and Project
 * Recommendations (RC2.7) — into a set of deterministic, client-facing strategy
 * sections.
 *
 * Hard rules honoured here (locked down by the module tests):
 *  - It introduces NO new score, verdict, ranking, ROI, yield, appreciation,
 *    financial forecast, trust score, or investment score. Every readiness
 *    verdict it surfaces is REUSED verbatim from the output it consumes.
 *  - It never recalculates a metric from raw `ProjectDetail`; it consumes only
 *    already-derived Advisory outputs. It does not even take a `ProjectDetail`.
 *  - The hidden numeric `trust.trustScore` is NEVER surfaced or reused.
 *  - Anything not supported by verified data renders as the shared
 *    `NOT_AVAILABLE` sentinel. Nothing is fabricated.
 *  - Identical input always produces identical output (pure function). The only
 *    non-deterministic value — the generation timestamp — is never computed
 *    internally; it is surfaced only when the caller supplies `generatedAt`.
 */

/** Stable identifiers for every strategy section, in presentation order. */
export type ClientStrategySectionKey =
  | "investment"
  | "purchase"
  | "rental"
  | "exit"
  | "risk"
  | "action-plan";

/** One evidence point. `value` is reused verbatim, or `NOT_AVAILABLE`. */
export interface ClientStrategyPoint {
  label: string;
  value: string;
}

/**
 * One strategy section. Every substantive field is reused verbatim from an
 * already-derived Advisory output; only the controlled `summary` framing and the
 * Action Plan's immediate step are assembled from fixed sentence templates over
 * the existing conclusions — never a new metric.
 */
export interface ClientStrategySection {
  key: ClientStrategySectionKey;
  title: string;
  /** A controlled, one-line framing that RESTATES an already-derived conclusion. */
  summary: string;
  /**
   * The relevant foundation readiness verdict, reused verbatim. Present ONLY for
   * sections that map to an existing foundation verdict (Investment, Rental).
   * Absent otherwise — a section never invents a verdict of its own.
   */
  readinessVerdict?: PassportReadinessVerdict;
  /** Evidence points, each value reused verbatim from a derived output. */
  points: ClientStrategyPoint[];
  /** Evidence-backed cautions / recorded gaps, reused verbatim. */
  considerations: string[];
  /** True when at least one evidence point or consideration is on record. */
  available: boolean;
}

/** Provenance metadata — never fabricated. */
export interface ClientStrategyMetadata {
  schemaVersion: "1.0";
  strategyVersion: "1.0";
  /** Names the composition source — the Advisory derived outputs. */
  source: "advisory-client-strategy";
  projectSlug: string;
  projectName: string;
  /** The Passport overall readiness verdict, mirrored for at-a-glance context. */
  readinessVerdict: PassportReadinessVerdict;
  /** The already-derived outputs this strategy composes, in architectural order. */
  consumes: string[];
  /**
   * Generation timestamp. Never computed inside the pure derivation; present
   * ONLY when the caller supplies `generatedAt`, and entirely absent otherwise.
   */
  generatedAt?: string;
}

/**
 * The complete, presentational-ready Client Strategy for one project. Every
 * substantive value is reused verbatim from an already-derived Advisory output.
 */
export interface ClientStrategy {
  /** The ordered list of section keys present in this strategy. */
  sections: ClientStrategySectionKey[];
  investment: ClientStrategySection;
  purchase: ClientStrategySection;
  rental: ClientStrategySection;
  exit: ClientStrategySection;
  risk: ClientStrategySection;
  actionPlan: ClientStrategySection;
  /** Controlled, evidence-only basis note. Never promotional. */
  basis: string;
  metadata: ClientStrategyMetadata;
}

/**
 * Inputs for the derivation. The Passport, Summary and the three Intelligence
 * foundations are REQUIRED — they are the already-derived outputs the strategy
 * composes. Comparison and Recommendations are optional. Kept as an options
 * object, matching the RC2.5–RC2.8 derivation signatures.
 */
export interface DeriveClientStrategyInput {
  /** Already-derived Forever Passport (RC2.4). */
  passport: ForeverPassport;
  /** Already-derived Project Summary (RC2.5). */
  summary: ProjectSummary;
  /** Already-derived Investment Intelligence (RC2.1). */
  investment: InvestmentIntelligence;
  /** Already-derived Rental Intelligence (RC2.2). */
  rental: RentalIntelligence;
  /** Already-derived Location Intelligence (RC2.3). */
  location: LocationIntelligence;
  /** Optional already-derived Project Comparison (RC2.6). */
  comparison?: ProjectComparison;
  /** Optional already-derived Project Recommendations (RC2.7). */
  recommendations?: ProjectRecommendations;
  /**
   * Caller-supplied generation timestamp. Surfaced verbatim in metadata. When
   * omitted, no timestamp appears anywhere in the strategy.
   */
  generatedAt?: string;
}

/** Controlled, evidence-only basis statement. Restrained, never promotional. */
const BASIS_NOTE =
  "This strategy composes only previously derived Forever Advisory conclusions. No new scores, " +
  'verdicts, rankings or financial figures are produced; values not on record are shown as "Not ' +
  'available".';

/** Fixed framing sentences for the sections that do not map to a foundation verdict. */
const PURCHASE_SUMMARY =
  "Purchase positioning reflects only the recorded pricing, availability and ownership evidence.";
const EXIT_SUMMARY =
  "Exit positioning reflects only the recorded liquidity, pricing and location evidence; no " +
  "forward-looking appreciation or resale figures are on record.";
const RISK_SUMMARY =
  "Risk positioning reflects the already-derived readiness verdicts and evidence-backed " +
  "considerations on file.";

/** Immediate next step keyed off the overall readiness verdict (reused verbatim). */
const IMMEDIATE_STEP: Record<PassportReadinessVerdict, string> = {
  "Insufficient verified data":
    "Establish the foundational evidence listed below before advancing the project.",
  "More evidence required":
    "Gather the outstanding evidence listed below before advancing to a preliminary review.",
  "Ready for preliminary review":
    "Proceed to a preliminary review using the verified evidence currently on record.",
};

function isPresent(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && value !== NOT_AVAILABLE;
}

/**
 * Deduplicate a list of strings case-insensitively, preserving first-seen order
 * and dropping empties. Reused conclusions surfaced by more than one output
 * collapse to a single entry.
 */
function dedupe(items: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value.length === 0) continue;
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

/** Assemble a section, computing `available` from its evidence content only. */
function makeSection(section: Omit<ClientStrategySection, "available">): ClientStrategySection {
  const available =
    section.points.some((point) => isPresent(point.value)) || section.considerations.length > 0;
  return { ...section, available };
}

/**
 * Derive the Client Strategy by composing already-derived Advisory outputs. Pure
 * and deterministic: no timestamps, no randomness, no I/O, no new metric.
 */
export function deriveClientStrategy(input: DeriveClientStrategyInput): ClientStrategy {
  const {
    passport,
    summary,
    investment,
    rental,
    location,
    comparison,
    recommendations,
    generatedAt,
  } = input;

  const projectName = passport.identity.projectName;
  const projectSlug = passport.identity.projectSlug;
  const overallVerdict = passport.overallVerdict.readinessVerdict;
  const hasGeneratedAt = typeof generatedAt === "string" && generatedAt.trim().length > 0;

  // --- Investment Strategy (reuses the Investment foundation verdict) ------
  const investmentSection = makeSection({
    key: "investment",
    title: "Investment Strategy",
    summary: `Investment readiness: ${passport.investment.readinessVerdict}.`,
    readinessVerdict: passport.investment.readinessVerdict,
    points: [
      { label: "Entry price", value: investment.entryPrice },
      { label: "Price verification", value: investment.priceVerificationStatus },
      { label: "Investment evidence", value: investment.investmentEvidence },
      { label: "Rental income evidence", value: investment.rentalEvidence },
      { label: "Developer", value: investment.developerContext },
      { label: "Basis", value: passport.investment.verdictRationale },
    ],
    considerations: [...investment.keyDataGaps],
  });

  // --- Purchase Strategy (recorded pricing / availability / ownership) -----
  const purchaseSection = makeSection({
    key: "purchase",
    title: "Purchase Strategy",
    summary: PURCHASE_SUMMARY,
    points: [
      { label: "Entry price", value: investment.entryPrice },
      { label: "Availability", value: investment.availableUnitRange },
      { label: "Ownership / tenure", value: passport.identity.ownershipType },
      { label: "Price verification", value: investment.priceVerificationStatus },
      { label: "Liquidity", value: investment.liquidityEvidence },
    ],
    considerations: [],
  });

  // --- Rental Strategy (reuses the Rental foundation verdict) --------------
  const rentalSection = makeSection({
    key: "rental",
    title: "Rental Strategy",
    summary: `Rental readiness: ${passport.rental.readinessVerdict}.`,
    readinessVerdict: passport.rental.readinessVerdict,
    points: [
      { label: "Rental demand", value: rental.demandContext },
      { label: "Income evidence", value: rental.incomeEvidence },
      { label: "Occupancy evidence", value: rental.occupancyEvidence },
      { label: "Rental guarantee", value: rental.guaranteeEvidence },
      { label: "Management", value: rental.managementContext },
      { label: "Basis", value: passport.rental.verdictRationale },
    ],
    considerations: [...rental.keyDataGaps],
  });

  // --- Exit Strategy (recorded liquidity / pricing / location evidence) ----
  const exitSection = makeSection({
    key: "exit",
    title: "Exit Strategy",
    summary: EXIT_SUMMARY,
    points: [
      { label: "Liquidity evidence", value: investment.liquidityEvidence },
      { label: "Price verification", value: investment.priceVerificationStatus },
      { label: "Resale / location evidence", value: location.resaleLocationEvidence },
      { label: "Ownership / tenure", value: passport.identity.ownershipType },
    ],
    considerations: [],
  });

  // --- Risk Strategy (reuses per-domain readiness + Summary considerations) -
  const riskSection = makeSection({
    key: "risk",
    title: "Risk Strategy",
    summary: RISK_SUMMARY,
    points: [
      { label: "Trust readiness", value: passport.trust.readinessVerdict },
      { label: "Investment readiness", value: passport.investment.readinessVerdict },
      { label: "Rental readiness", value: passport.rental.readinessVerdict },
      { label: "Location readiness", value: passport.location.readinessVerdict },
    ],
    considerations: dedupe(summary.considerations),
  });

  // --- Action Plan (overall readiness + evidence still to obtain) ----------
  const actionPoints: ClientStrategyPoint[] = [
    { label: "Immediate step", value: IMMEDIATE_STEP[overallVerdict] },
  ];
  // Optional: surface the evidence-coverage leading candidate, reused verbatim.
  if (recommendations?.topRecommendation) {
    actionPoints.push({
      label: "Leading candidate (evidence coverage)",
      value: recommendations.topRecommendation.projectName || NOT_AVAILABLE,
    });
  }
  const actionPlanSection: ClientStrategySection = {
    key: "action-plan",
    title: "Action Plan",
    summary: `Overall advisory readiness: ${overallVerdict}.`,
    points: actionPoints,
    considerations: [...passport.combinedGaps.combined],
    // The Action Plan always carries at least the readiness statement + step.
    available: true,
  };

  const sections: ClientStrategySectionKey[] = [
    "investment",
    "purchase",
    "rental",
    "exit",
    "risk",
    "action-plan",
  ];

  const consumes = [
    "forever-passport",
    "project-summary",
    "investment-intelligence",
    "rental-intelligence",
    "location-intelligence",
  ];
  if (comparison) consumes.push("project-comparison");
  if (recommendations) consumes.push("project-recommendations");

  const metadata: ClientStrategyMetadata = {
    schemaVersion: "1.0",
    strategyVersion: "1.0",
    source: "advisory-client-strategy",
    projectSlug,
    projectName,
    readinessVerdict: overallVerdict,
    consumes,
    // generatedAt is added ONLY when supplied (see below).
  };
  if (hasGeneratedAt) {
    metadata.generatedAt = generatedAt.trim();
  }

  return {
    sections,
    investment: investmentSection,
    purchase: purchaseSection,
    rental: rentalSection,
    exit: exitSection,
    risk: riskSection,
    actionPlan: actionPlanSection,
    basis: BASIS_NOTE,
    metadata,
  };
}
