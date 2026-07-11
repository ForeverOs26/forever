import type { ProjectDetail } from "@/features/project-detail/project-detail-types";

import {
  NOT_AVAILABLE,
  deriveInvestmentIntelligence,
  type InvestmentIntelligence,
} from "./investment-intelligence";
import { deriveRentalIntelligence, type RentalIntelligence } from "./rental-intelligence";
import { deriveLocationIntelligence, type LocationIntelligence } from "./location-intelligence";
import type { ForeverPassport, PassportReadinessVerdict } from "./forever-passport";

/**
 * Project Summary — Executive summary layer (Sprint RC2.5).
 *
 * A concise, evidence-only executive summary of a project for the Advisory
 * Workspace. It sits ONE layer above the Forever Passport in the exact same
 * architecture:
 *
 *   ProjectDetail
 *     ↓ project.trust (verified fields, via the Passport)
 *     ↓ deriveInvestmentIntelligence()
 *     ↓ deriveRentalIntelligence()
 *     ↓ deriveLocationIntelligence()
 *   deriveForeverPassport()
 *     ↓
 *   deriveProjectSummary()  ← this layer (pure, deterministic summarisation)
 *     ↓
 *   Advisory Workspace
 *
 * This is NOT a new scoring system, NOT a new intelligence foundation, and NOT a
 * marketing description. It SUMMARISES the existing verified project facts and
 * the already-derived Advisory intelligence outputs. Hard rules honoured here
 * (locked down by the module tests):
 *
 *  - It introduces NO new scoring engine. It never invents, averages, or
 *    calculates a score, rating, yield, ROI, appreciation, occupancy, liquidity,
 *    or location metric. It never converts a qualitative verdict into a number.
 *  - The hidden numeric `trust.trustScore` (and every foundation score sentinel)
 *    is NEVER surfaced or reused.
 *  - It RE-USES the existing derived outputs. Readiness comes verbatim from the
 *    Passport's overall verdict — no second readiness engine. Strengths,
 *    considerations, and data gaps are aggregated from the already-derived
 *    Passport + Intelligence outputs, never recalculated from raw ProjectDetail.
 *  - Anything not supported by verified data renders as the shared
 *    `NOT_AVAILABLE` sentinel. Nothing is fabricated.
 *  - Strengths, considerations, and data limitations are de-duplicated and kept
 *    in a stable, deterministic order.
 *  - Identical input always produces identical output (pure function). The only
 *    non-deterministic value — the generation timestamp — is never computed
 *    internally; it is surfaced only when the caller supplies it.
 */

/** Stable keys for the four aggregated intelligence domains. */
export type ProjectSummaryDomainKey = "trust" | "investment" | "rental" | "location";

/** One domain signal line in the executive overview. */
export interface ProjectSummarySignal {
  key: ProjectSummaryDomainKey;
  label: string;
  /** The strongest present evidence for the domain, or `NOT_AVAILABLE`. */
  value: string;
}

/**
 * 1. Executive overview — concise and factual. Built from controlled sentence
 * templates over existing verified facts and derived verdicts. Never free-form
 * speculative prose.
 */
export interface ProjectSummaryOverview {
  /** Controlled one-sentence description assembled from present identity facts. */
  headline: string;
  /** Readiness restated from the Passport overall verdict. */
  readinessStatement: string;
  /** The main evidence-backed trust/investment/rental/location signals. */
  signals: ProjectSummarySignal[];
}

/** A single surfaced key fact. Present-only: absent fields are never included. */
export interface ProjectSummaryFact {
  label: string;
  value: string;
}

/**
 * 5. Suitable buyer profile. There is no separate verified buyer-profile or
 * suitability engine in the repository, so this is NEVER a fabricated demographic
 * persona. It surfaces only evidence-linked suitability notes, or renders as
 * unavailable when the record supports none.
 */
export interface ProjectSummaryBuyerProfile {
  /** True when at least one evidence-linked suitability note exists. */
  available: boolean;
  /** Deduplicated, evidence-linked suitability notes. Empty when unavailable. */
  statements: string[];
  /** Shown when `available` is false — the shared unavailable convention. */
  unavailableLabel: typeof NOT_AVAILABLE;
  /** Plain-language basis: derived from recorded evidence, not a persona engine. */
  basis: string;
}

/**
 * 6. Decision readiness. Re-uses the Passport readiness verdict verbatim — no
 * second readiness engine. The explanation is a controlled template grounded in
 * the existing Passport result and available/missing evidence counts.
 */
export interface ProjectSummaryReadiness {
  /** The Passport overall verdict, reused verbatim. Never recomputed. */
  verdict: PassportReadinessVerdict;
  /** The Passport overall rationale, reused verbatim. */
  rationale: string;
  /** Controlled explanation grounded in the verdict and evidence coverage. */
  explanation: string;
  foundationsReady: number;
  foundationsTotal: number;
  signalsPresent: number;
  signalsTotal: number;
}

/** Provenance metadata — never fabricated. */
export interface ProjectSummaryMetadata {
  schemaVersion: "1.0";
  summaryVersion: "1.0";
  /** Names the summarisation source — the Passport + intelligence foundations. */
  source: "advisory-project-summary";
  projectSlug: string;
  projectName: string;
  /** The Passport overall readiness verdict, mirrored for at-a-glance context. */
  readinessVerdict: PassportReadinessVerdict;
  /** The already-derived outputs this summary consumes, in architectural order. */
  consumes: string[];
  /**
   * Generation timestamp. Never computed inside the pure derivation; it is the
   * caller-supplied value, or `NOT_AVAILABLE` when none is supplied.
   */
  generatedAt: string;
}

/** The complete, presentational-ready Project Summary for one project. */
export interface ProjectSummary {
  overview: ProjectSummaryOverview;
  keyFacts: ProjectSummaryFact[];
  strengths: string[];
  considerations: string[];
  buyerProfile: ProjectSummaryBuyerProfile;
  decisionReadiness: ProjectSummaryReadiness;
  dataLimitations: string[];
  metadata: ProjectSummaryMetadata;
}

/** Inputs for the derivation. Kept as an options object per the RC2.5 spec. */
export interface DeriveProjectSummaryInput {
  project: ProjectDetail;
  /** The already-derived Forever Passport. Required — it is the primary source. */
  passport: ForeverPassport;
  /**
   * Optional already-derived Investment Intelligence. When omitted the existing
   * `deriveInvestmentIntelligence` is reused (never re-implemented) so the
   * summary always consumes the canonical derived output.
   */
  investment?: InvestmentIntelligence;
  /** Optional already-derived Rental Intelligence (reused when omitted). */
  rental?: RentalIntelligence;
  /** Optional already-derived Location Intelligence (reused when omitted). */
  location?: LocationIntelligence;
  /** Caller-supplied generation timestamp. Surfaced verbatim in metadata. */
  generatedAt?: string;
}

const DOMAIN_LABEL: Record<ProjectSummaryDomainKey, string> = {
  trust: "Trust Intelligence",
  investment: "Investment Intelligence",
  rental: "Rental Intelligence",
  location: "Location Intelligence",
};

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Present-only value: a real derived value, or `null` when it is unavailable. */
function present(value: string | null | undefined): string | null {
  if (!hasText(value)) return null;
  const trimmed = value.trim();
  return trimmed === NOT_AVAILABLE ? null : trimmed;
}

/**
 * De-duplicate a list of strings, case-insensitively, preserving first-seen
 * order and dropping empties. Used for strengths, considerations, and data
 * limitations so identical facts surfaced by different domains collapse to one.
 */
function dedupe(items: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    if (!hasText(raw)) continue;
    const value = raw.trim();
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

/** Distinct, cleaned, first-seen-ordered list of strings. */
function distinctText(values: Array<string | null | undefined>): string[] {
  return dedupe(values);
}

// ---------------------------------------------------------------------------
// 1. Executive overview
// ---------------------------------------------------------------------------

function deriveOverview(
  passport: ForeverPassport,
  investment: InvestmentIntelligence,
  rental: RentalIntelligence,
  location: LocationIntelligence,
): ProjectSummaryOverview {
  const { identity, overallVerdict } = passport;

  // Controlled sentence template — every clause is optional and evidence-backed.
  const name = present(identity.projectName) ?? "This project";
  const type = present(identity.propertyType);
  const loc = present(identity.location);
  const developer = present(identity.developerName);
  const construction = present(identity.constructionStatus);

  let headline = name;
  headline += type ? ` is a ${type}` : " is a project";
  if (loc) headline += ` in ${loc}`;
  if (developer) headline += ` by ${developer}`;
  if (construction) headline += `, currently ${construction}`;
  headline += ".";

  const readinessStatement = `Overall advisory readiness: ${overallVerdict.readinessVerdict}.`;

  const signals: ProjectSummarySignal[] = [
    {
      key: "trust",
      label: DOMAIN_LABEL.trust,
      value: passport.trust.verificationStatus,
    },
    {
      key: "investment",
      label: DOMAIN_LABEL.investment,
      value: present(investment.entryPrice) ?? NOT_AVAILABLE,
    },
    {
      key: "rental",
      label: DOMAIN_LABEL.rental,
      value: present(rental.demandContext) ?? NOT_AVAILABLE,
    },
    {
      key: "location",
      label: DOMAIN_LABEL.location,
      value: present(location.locationIdentity) ?? NOT_AVAILABLE,
    },
  ];

  return { headline, readinessStatement, signals };
}

// ---------------------------------------------------------------------------
// 2. Key project facts (present-only; absent fields go to data limitations)
// ---------------------------------------------------------------------------

function deriveKeyFacts(
  project: ProjectDetail,
  passport: ForeverPassport,
  investment: InvestmentIntelligence,
): ProjectSummaryFact[] {
  const { identity } = passport;

  const unitTypes = distinctText(project.units.map((unit) => unit.type));
  const paymentPlans = distinctText(project.units.map((unit) => unit.paymentPlan));

  const candidates: Array<[string, string | null]> = [
    ["Developer", present(identity.developerName)],
    ["Location", present(identity.location)],
    ["Project type", present(identity.propertyType)],
    ["Construction status", present(identity.constructionStatus)],
    ["Tenure / ownership", present(identity.ownershipType)],
    ["Starting price", present(investment.entryPrice)],
    ["Unit types", unitTypes.length > 0 ? unitTypes.join(", ") : null],
    ["Payment plan", paymentPlans.length > 0 ? paymentPlans.join(", ") : null],
    [
      "Project scale",
      project.units.length > 0 ? `${project.units.length} unit(s) on record` : null,
    ],
  ];

  return candidates
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([label, value]) => ({ label, value }));
}

// ---------------------------------------------------------------------------
// 3. Principal strengths (aggregated from existing derived outputs)
// ---------------------------------------------------------------------------

function deriveStrengths(
  passport: ForeverPassport,
  investment: InvestmentIntelligence,
  rental: RentalIntelligence,
  location: LocationIntelligence,
): string[] {
  const trust = passport.trust;
  const candidates: string[] = [];

  // Trust — from the Passport's verified trust signals.
  if (trust.signals.hasVerification) candidates.push("Forever Verified project record.");
  if (trust.signals.hasVerdict) candidates.push(`Recorded Forever verdict: ${trust.verdict}.`);
  if (trust.signals.hasMarketPosition) {
    candidates.push(`Recorded market position: ${trust.marketPosition}.`);
  }
  if (trust.signals.hasInspection) candidates.push("Independently inspected on record.");

  // Investment — from the Investment foundation signals.
  if (investment.signals.hasVerifiedPrice) candidates.push("Independently verified pricing.");
  if (investment.signals.hasIncomeEvidence) candidates.push("Rental income evidence on record.");
  if (investment.signals.hasUnitInventory) candidates.push("Unit inventory available for review.");

  // Rental — from the Rental foundation signals.
  if (rental.signals.hasDemandSignal) {
    candidates.push(`Recorded rental demand: ${recordedRentalDemand(rental)}.`);
  }
  // Same underlying fact as the Investment income signal → de-duplicated below.
  if (rental.signals.hasIncomeEvidence) candidates.push("Rental income evidence on record.");
  if (rental.signals.hasGuarantee) candidates.push("Rental guarantee available.");
  if (rental.signals.hasManagement) candidates.push("Professional rental management on record.");

  // Location — from the Location foundation signals.
  if (location.signals.hasBeachProximity) candidates.push("Beach proximity on record.");
  if (location.signals.hasLifestyle) candidates.push("Lifestyle and amenity context on record.");
  if (location.signals.hasInfrastructure) {
    candidates.push("Nearby schools/hospitals on record.");
  }

  return dedupe(candidates);
}

/** The recorded rental-demand value, stripped of the foundation's prefix. */
function recordedRentalDemand(rental: RentalIntelligence): string {
  return rental.demandContext.replace(/^Recorded rental demand:\s*/i, "").trim();
}

// ---------------------------------------------------------------------------
// 4. Principal considerations (evidence-backed cautions — never exaggerated)
// ---------------------------------------------------------------------------

function deriveConsiderations(
  passport: ForeverPassport,
  investment: InvestmentIntelligence,
  rental: RentalIntelligence,
  location: LocationIntelligence,
): string[] {
  const trust = passport.trust;
  const candidates: string[] = [];

  if (!trust.signals.hasVerification) candidates.push("Project is not Forever Verified.");

  // Price listed but not independently verified — a caution, not a gap.
  if (investment.signals.hasEntryPrice && !investment.signals.hasVerifiedPrice) {
    candidates.push("Entry price is listed but not independently verified.");
  }

  // Missing income evidence surfaces from both Investment and Rental → deduped.
  if (!investment.signals.hasIncomeEvidence) {
    candidates.push("Rental income evidence is not on record.");
  }
  if (!rental.signals.hasIncomeEvidence) {
    candidates.push("Rental income evidence is not on record.");
  }

  // Per-domain readiness shortfalls, reusing the derived verdicts (never recomputed).
  const domains: Array<[ProjectSummaryDomainKey, PassportReadinessVerdict]> = [
    ["trust", trust.readinessVerdict],
    ["investment", investment.readinessVerdict],
    ["rental", rental.readinessVerdict],
    ["location", location.readinessVerdict],
  ];
  for (const [key, verdict] of domains) {
    if (verdict === "Insufficient verified data") {
      candidates.push(
        `${DOMAIN_LABEL[key]} has insufficient verified data for a preliminary review.`,
      );
    }
  }

  return dedupe(candidates);
}

// ---------------------------------------------------------------------------
// 5. Suitable buyer profile (evidence-linked only; never a fabricated persona)
// ---------------------------------------------------------------------------

function deriveBuyerProfile(
  passport: ForeverPassport,
  investment: InvestmentIntelligence,
  rental: RentalIntelligence,
  location: LocationIntelligence,
): ProjectSummaryBuyerProfile {
  const candidates: string[] = [];

  // Rental-return orientation — grounded strictly in recorded rental evidence.
  if (
    rental.signals.hasIncomeEvidence ||
    rental.signals.hasGuarantee ||
    investment.signals.hasIncomeEvidence
  ) {
    candidates.push(
      "Recorded rental income evidence is relevant to buyers prioritising rental returns.",
    );
  }

  // Full-ownership orientation — grounded in the recorded tenure.
  if (present(passport.identity.ownershipType)) {
    candidates.push(
      `Recorded ${passport.identity.ownershipType} tenure is relevant to buyers prioritising ownership certainty.`,
    );
  }

  // Lifestyle orientation — grounded in recorded location context.
  if (location.signals.hasLifestyle || location.signals.hasBeachProximity) {
    candidates.push(
      "Recorded lifestyle and location context is relevant to lifestyle-oriented buyers.",
    );
  }

  const statements = dedupe(candidates);

  return {
    available: statements.length > 0,
    statements,
    unavailableLabel: NOT_AVAILABLE,
    basis:
      "Derived only from recorded project evidence. No separate verified buyer-profile output exists; no demographic persona is inferred.",
  };
}

// ---------------------------------------------------------------------------
// 6. Decision readiness (reuses the Passport verdict verbatim)
// ---------------------------------------------------------------------------

const READINESS_EXPLANATION: Record<PassportReadinessVerdict, string> = {
  "Insufficient verified data":
    "The verified record does not yet carry enough foundational evidence for a preliminary review.",
  "More evidence required":
    "Foundational evidence is present, but more supporting evidence is required before a preliminary review.",
  "Ready for preliminary review":
    "The verified record carries enough evidence across the foundations for a preliminary review.",
};

function deriveDecisionReadiness(passport: ForeverPassport): ProjectSummaryReadiness {
  const { overallVerdict, evidenceCoverage, dataCompleteness } = passport;
  const verdict = overallVerdict.readinessVerdict;

  const explanation =
    `${READINESS_EXPLANATION[verdict]} ` +
    `${evidenceCoverage.foundationsReady} of ${evidenceCoverage.foundationsTotal} foundations meet the preliminary-review threshold; ` +
    `${dataCompleteness.signalsPresent} of ${dataCompleteness.signalsTotal} verified evidence signals are present.`;

  return {
    verdict,
    rationale: overallVerdict.rationale,
    explanation,
    foundationsReady: evidenceCoverage.foundationsReady,
    foundationsTotal: evidenceCoverage.foundationsTotal,
    signalsPresent: dataCompleteness.signalsPresent,
    signalsTotal: dataCompleteness.signalsTotal,
  };
}

// ---------------------------------------------------------------------------
// 7. Data limitations (deduped union of the foundation gaps)
// ---------------------------------------------------------------------------

/**
 * Canonicalises semantically-equal gap labels surfaced by different foundations
 * so the union de-duplicates cleanly (e.g. the Investment "Rental / income
 * evidence" gap and the Rental "Rental income evidence" gap are the same gap).
 */
const GAP_CANONICAL: Record<string, string> = {
  "Rental / income evidence": "Rental income evidence",
};

function canonicalGap(gap: string): string {
  return GAP_CANONICAL[gap.trim()] ?? gap.trim();
}

function deriveDataLimitations(passport: ForeverPassport): string[] {
  const order: ProjectSummaryDomainKey[] = ["trust", "investment", "rental", "location"];
  const gaps = order.flatMap((key) => passport.combinedGaps.byFoundation[key].map(canonicalGap));
  return dedupe(gaps);
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

function deriveMetadata(
  passport: ForeverPassport,
  generatedAt: string | undefined,
): ProjectSummaryMetadata {
  return {
    schemaVersion: "1.0",
    summaryVersion: "1.0",
    source: "advisory-project-summary",
    projectSlug: passport.identity.projectSlug,
    projectName: passport.identity.projectName,
    readinessVerdict: passport.overallVerdict.readinessVerdict,
    consumes: [
      "Forever Passport",
      DOMAIN_LABEL.trust,
      DOMAIN_LABEL.investment,
      DOMAIN_LABEL.rental,
      DOMAIN_LABEL.location,
    ],
    generatedAt: hasText(generatedAt) ? generatedAt.trim() : NOT_AVAILABLE,
  };
}

/**
 * Derive the Project Summary for a project. Pure and deterministic: identical
 * inputs yield identical output.
 *
 * The summary CONSUMES the already-derived Forever Passport and the Intelligence
 * foundation outputs. It never recalculates a verdict, never duplicates
 * foundation-specific logic, and never fabricates a value. When the optional
 * intelligence outputs are omitted, the existing foundation derivations are
 * reused so the canonical derived output is always the source.
 */
export function deriveProjectSummary(input: DeriveProjectSummaryInput): ProjectSummary {
  const { project, passport } = input;

  const investment = input.investment ?? deriveInvestmentIntelligence(project);
  const rental = input.rental ?? deriveRentalIntelligence(project);
  const location = input.location ?? deriveLocationIntelligence(project);

  const overview = deriveOverview(passport, investment, rental, location);
  const keyFacts = deriveKeyFacts(project, passport, investment);
  const strengths = deriveStrengths(passport, investment, rental, location);
  const considerations = deriveConsiderations(passport, investment, rental, location);
  const buyerProfile = deriveBuyerProfile(passport, investment, rental, location);
  const decisionReadiness = deriveDecisionReadiness(passport);
  const dataLimitations = deriveDataLimitations(passport);
  const metadata = deriveMetadata(passport, input.generatedAt);

  return {
    overview,
    keyFacts,
    strengths,
    considerations,
    buyerProfile,
    decisionReadiness,
    dataLimitations,
    metadata,
  };
}
