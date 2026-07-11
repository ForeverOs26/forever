import type { ProjectDetail } from "@/features/project-detail/project-detail-types";

import {
  INVESTMENT_SCORE_UNAVAILABLE,
  NOT_AVAILABLE,
  deriveInvestmentIntelligence,
  type InvestmentIntelligence,
} from "./investment-intelligence";
import {
  RENTAL_SCORE_UNAVAILABLE,
  deriveRentalIntelligence,
  type RentalIntelligence,
} from "./rental-intelligence";
import {
  LOCATION_SCORE_UNAVAILABLE,
  deriveLocationIntelligence,
  type LocationIntelligence,
} from "./location-intelligence";

/**
 * Forever Passport — Integration layer (Sprint RC2.4).
 *
 * The Passport is the executive summary of the Advisory Workspace. It
 * AGGREGATES the already-merged Intelligence foundations into one unified,
 * evidence-based project passport. It mirrors the existing Intelligence
 * architecture exactly:
 *
 *   ProjectDetail
 *     ↓ Trust (project.trust — verified fields)
 *     ↓ deriveInvestmentIntelligence()
 *     ↓ deriveRentalIntelligence()
 *     ↓ deriveLocationIntelligence()
 *   deriveForeverPassport()  ← this layer
 *     ↓
 *   Advisory Workspace
 *
 * Hard rules honoured here (locked down by the module tests):
 *  - The Passport introduces NO new scoring engine. It never invents, averages,
 *    or calculates a score, rating, yield, ROI, or any numeric quality metric.
 *  - It aggregates EXISTING verified information only. Investment, Rental and
 *    Location facts come exclusively from the existing derivation layers
 *    (`deriveInvestmentIntelligence` / `deriveRentalIntelligence` /
 *    `deriveLocationIntelligence`) — never recalculated from raw ProjectDetail.
 *    No derivation logic, rule, or data-shape is duplicated.
 *  - Trust facts come exclusively from the verified `project.trust` fields,
 *    surfaced as evidence/status only. `trust.trustScore` is NEVER surfaced or
 *    reused as any passport score — consistent with all three foundations.
 *  - Anything that cannot be supported by verified ProjectDetail data renders
 *    as the shared `NOT_AVAILABLE` sentinel. Nothing is fabricated.
 *  - The overall readiness verdict is fully DETERMINISTIC: it is the single
 *    most conservative (lowest) of the four foundation readiness verdicts. No
 *    averaging, no new rule, no AI opinion.
 *  - Identical input always produces identical output (pure function). The only
 *    non-deterministic value — the generation timestamp — is never computed
 *    internally; it is surfaced only when the caller supplies it.
 */

/**
 * The single readiness scale shared by every Intelligence foundation and by the
 * Passport's overall verdict. Ordered low → high. Reused verbatim so the
 * Passport never introduces a new verdict vocabulary.
 */
export type PassportReadinessVerdict =
  | "Insufficient verified data"
  | "More evidence required"
  | "Ready for preliminary review";

/** Ordinal ranking used only to pick the most conservative (lowest) verdict. */
const READINESS_ORDER: Record<PassportReadinessVerdict, number> = {
  "Insufficient verified data": 0,
  "More evidence required": 1,
  "Ready for preliminary review": 2,
};

/** Stable keys for the four aggregated intelligence foundations. */
export type PassportFoundationKey = "trust" | "investment" | "rental" | "location";

/** 1. Project Identity — evidence-only, from `project.core` + `developer`. */
export interface PassportProjectIdentity {
  projectName: string;
  foreverId: string;
  projectSlug: string;
  propertyType: string;
  location: string;
  ownershipType: string;
  constructionStatus: string;
  developerName: string;
}

/** Boolean evidence signals behind the Trust readiness verdict. */
export interface PassportTrustSignals {
  /** The project carries the verified `foreverVerified` flag. */
  hasVerification: boolean;
  /** A recorded Forever verdict string exists. */
  hasVerdict: boolean;
  /** A recorded market-position string exists. */
  hasMarketPosition: boolean;
  /** A recorded last-inspection date exists. */
  hasInspection: boolean;
  /** A recorded trust note exists. */
  hasTrustNote: boolean;
}

/** 2. Trust Intelligence Summary — evidence-only, from `project.trust`. */
export interface PassportTrustSummary {
  /** Verification status derived from the `foreverVerified` boolean. */
  verificationStatus: string;
  verdict: string;
  marketPosition: string;
  lastInspection: string;
  trustNote: string;
  keyDataGaps: string[];
  readinessVerdict: PassportReadinessVerdict;
  verdictRationale: string;
  signalsPresent: number;
  signalsTotal: number;
  signals: PassportTrustSignals;
}

/** 3. Investment Intelligence Summary — sourced from the Investment foundation. */
export interface PassportInvestmentSummary {
  entryPrice: string;
  priceVerificationStatus: string;
  rentalEvidence: string;
  keyDataGaps: string[];
  readinessVerdict: PassportReadinessVerdict;
  verdictRationale: string;
  signalsPresent: number;
  signalsTotal: number;
  /** Always the foundation's own score sentinel — never a number. */
  scoreStatus: typeof INVESTMENT_SCORE_UNAVAILABLE;
}

/** 4. Rental Intelligence Summary — sourced from the Rental foundation. */
export interface PassportRentalSummary {
  demandContext: string;
  incomeEvidence: string;
  guaranteeEvidence: string;
  keyDataGaps: string[];
  readinessVerdict: PassportReadinessVerdict;
  verdictRationale: string;
  signalsPresent: number;
  signalsTotal: number;
  /** Always the foundation's own score sentinel — never a number. */
  scoreStatus: typeof RENTAL_SCORE_UNAVAILABLE;
}

/** 5. Location Intelligence Summary — sourced from the Location foundation. */
export interface PassportLocationSummary {
  locationIdentity: string;
  beachProximity: string;
  lifestyleEvidence: string;
  keyDataGaps: string[];
  readinessVerdict: PassportReadinessVerdict;
  verdictRationale: string;
  signalsPresent: number;
  signalsTotal: number;
  /** Always the foundation's own score sentinel — never a number. */
  scoreStatus: typeof LOCATION_SCORE_UNAVAILABLE;
}

/** Per-foundation contribution to the overall data-completeness measure. */
export interface PassportCompletenessRow {
  key: PassportFoundationKey;
  label: string;
  signalsPresent: number;
  signalsTotal: number;
}

/**
 * 6. Overall Data Completeness — a DATA-PRESENCE measure, not a quality score.
 * It counts how many verified evidence signals are present across all four
 * foundations. It never expresses, and never implies, a judgement of quality.
 */
export interface PassportDataCompleteness {
  signalsPresent: number;
  signalsTotal: number;
  /** Whole-number percentage of evidence signals present (presence, not quality). */
  percentComplete: number;
  byFoundation: PassportCompletenessRow[];
}

/** 7. Combined Key Data Gaps — the union of every foundation's gaps. */
export interface PassportCombinedGaps {
  /** Flat, domain-prefixed, deterministically ordered list. */
  combined: string[];
  byFoundation: Record<PassportFoundationKey, string[]>;
  totalGaps: number;
}

/** Per-foundation readiness verdict, for the overall verdict rationale. */
export interface PassportVerdictRow {
  key: PassportFoundationKey;
  label: string;
  readinessVerdict: PassportReadinessVerdict;
}

/**
 * 8. Overall Advisory Readiness Verdict — deterministic. It is the single most
 * conservative (lowest on the shared scale) of the four foundation verdicts.
 */
export interface PassportOverallVerdict {
  readinessVerdict: PassportReadinessVerdict;
  rationale: string;
  byFoundation: PassportVerdictRow[];
}

/** Per-foundation evidence-coverage row. */
export interface PassportEvidenceRow {
  key: PassportFoundationKey;
  label: string;
  readinessVerdict: PassportReadinessVerdict;
  signalsPresent: number;
  signalsTotal: number;
  /** Which verified ProjectDetail sources / foundation this row consumes. */
  source: string;
}

/** 9. Evidence Coverage Summary — how much of each foundation is evidenced. */
export interface PassportEvidenceCoverage {
  foundations: PassportEvidenceRow[];
  /** Foundations whose readiness is "Ready for preliminary review". */
  foundationsReady: number;
  foundationsTotal: number;
}

/** 10. Passport Metadata — provenance, never fabricated. */
export interface PassportMetadata {
  schemaVersion: "1.0";
  passportVersion: "1.0";
  /** Names the aggregation source — the Advisory intelligence foundations. */
  source: "advisory-intelligence-foundations";
  projectSlug: string;
  projectName: string;
  /** The foundations this passport aggregates, in architectural order. */
  foundationsConsumed: string[];
  /**
   * Generation timestamp. Never computed inside the pure derivation; it is the
   * caller-supplied value, or `NOT_AVAILABLE` when none is supplied.
   */
  generatedAt: string;
  /** Verified dates carried straight from the record (evidence-only). */
  lastInspection: string;
  lastPriceUpdate: string;
}

/** The complete, presentational-ready Forever Passport for one project. */
export interface ForeverPassport {
  identity: PassportProjectIdentity;
  trust: PassportTrustSummary;
  investment: PassportInvestmentSummary;
  rental: PassportRentalSummary;
  location: PassportLocationSummary;
  dataCompleteness: PassportDataCompleteness;
  combinedGaps: PassportCombinedGaps;
  overallVerdict: PassportOverallVerdict;
  evidenceCoverage: PassportEvidenceCoverage;
  metadata: PassportMetadata;
}

/** Options for the derivation. Kept optional so the function stays pure. */
export interface DeriveForeverPassportOptions {
  /**
   * Caller-supplied generation timestamp (e.g. an ISO string). Surfaced
   * verbatim in the metadata. Omitted → metadata reports `NOT_AVAILABLE`,
   * keeping the derivation fully deterministic for tests.
   */
  generatedAt?: string;
}

const FOUNDATION_LABEL: Record<PassportFoundationKey, string> = {
  trust: "Trust Intelligence",
  investment: "Investment Intelligence",
  rental: "Rental Intelligence",
  location: "Location Intelligence",
};

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function orNotAvailable(value: string | null | undefined): string {
  return hasText(value) ? value.trim() : NOT_AVAILABLE;
}

/** Count the `true` boolean signals given a foundation's signal values. */
function countSignals(values: boolean[]): {
  present: number;
  total: number;
} {
  return { present: values.filter(Boolean).length, total: values.length };
}

// ---------------------------------------------------------------------------
// 1. Project Identity
// ---------------------------------------------------------------------------

function deriveIdentity(project: ProjectDetail): PassportProjectIdentity {
  const { core, developer } = project;
  return {
    projectName: orNotAvailable(core.name),
    foreverId: orNotAvailable(core.slug),
    projectSlug: orNotAvailable(core.slug),
    propertyType: orNotAvailable(core.type),
    location: orNotAvailable(core.location),
    ownershipType: orNotAvailable(core.ownershipType),
    constructionStatus: orNotAvailable(core.constructionStatus),
    developerName: developer && hasText(developer.name) ? developer.name.trim() : NOT_AVAILABLE,
  };
}

// ---------------------------------------------------------------------------
// 2. Trust Intelligence Summary (evidence-only, from project.trust)
// ---------------------------------------------------------------------------

/**
 * Deterministic Trust readiness, mirroring the foundation pattern exactly.
 *
 * Foundational (both required to leave "Insufficient verified data"):
 *   hasVerification · hasVerdict
 * Depth: hasMarketPosition · hasInspection · hasTrustNote
 *   - Any foundational missing              → "Insufficient verified data"
 *   - Foundational present AND ≥ 2 depth    → "Ready for preliminary review"
 *   - Foundational present AND < 2 depth    → "More evidence required"
 */
function deriveTrustVerdict(signals: PassportTrustSignals): {
  readinessVerdict: PassportReadinessVerdict;
  verdictRationale: string;
} {
  const foundationalPresent = signals.hasVerification && signals.hasVerdict;
  const depthCount = [
    signals.hasMarketPosition,
    signals.hasInspection,
    signals.hasTrustNote,
  ].filter(Boolean).length;

  if (!foundationalPresent) {
    const missing: string[] = [];
    if (!signals.hasVerification) missing.push("Forever verification");
    if (!signals.hasVerdict) missing.push("Forever verdict");
    return {
      readinessVerdict: "Insufficient verified data",
      verdictRationale: `Missing foundational trust evidence: ${missing.join(", ")}.`,
    };
  }

  if (depthCount >= 2) {
    return {
      readinessVerdict: "Ready for preliminary review",
      verdictRationale: `Foundational trust evidence present with ${depthCount} of 3 supporting signals (market position, last inspection, trust note).`,
    };
  }

  return {
    readinessVerdict: "More evidence required",
    verdictRationale: `Foundational trust evidence present but only ${depthCount} of 3 supporting signals (market position, last inspection, trust note).`,
  };
}

function deriveTrustSummary(project: ProjectDetail): PassportTrustSummary {
  const { trust } = project;

  const signals: PassportTrustSignals = {
    hasVerification: trust.foreverVerified === true,
    hasVerdict: hasText(trust.verdict),
    hasMarketPosition: hasText(trust.marketPosition),
    hasInspection: hasText(trust.lastInspection),
    hasTrustNote: hasText(trust.trustNote),
  };

  const keyDataGaps: string[] = [];
  if (!signals.hasVerification) keyDataGaps.push("Forever verification");
  if (!signals.hasVerdict) keyDataGaps.push("Forever verdict");
  if (!signals.hasMarketPosition) keyDataGaps.push("Market position");
  if (!signals.hasInspection) keyDataGaps.push("Last inspection date");
  if (!signals.hasTrustNote) keyDataGaps.push("Trust note");

  const { readinessVerdict, verdictRationale } = deriveTrustVerdict(signals);
  const { present, total } = countSignals(Object.values(signals));

  return {
    verificationStatus: signals.hasVerification ? "Forever Verified" : "Not Forever Verified",
    verdict: orNotAvailable(trust.verdict),
    marketPosition: orNotAvailable(trust.marketPosition),
    lastInspection: orNotAvailable(trust.lastInspection),
    trustNote: orNotAvailable(trust.trustNote),
    keyDataGaps,
    readinessVerdict,
    verdictRationale,
    signalsPresent: present,
    signalsTotal: total,
    signals,
  };
}

// ---------------------------------------------------------------------------
// 3-5. Investment / Rental / Location summaries (consume foundation outputs)
// ---------------------------------------------------------------------------

function deriveInvestmentSummary(investment: InvestmentIntelligence): PassportInvestmentSummary {
  const { present, total } = countSignals(Object.values(investment.signals));
  return {
    entryPrice: investment.entryPrice,
    priceVerificationStatus: investment.priceVerificationStatus,
    rentalEvidence: investment.rentalEvidence,
    keyDataGaps: investment.keyDataGaps,
    readinessVerdict: investment.readinessVerdict,
    verdictRationale: investment.verdictRationale,
    signalsPresent: present,
    signalsTotal: total,
    scoreStatus: investment.investmentScore,
  };
}

function deriveRentalSummary(rental: RentalIntelligence): PassportRentalSummary {
  const { present, total } = countSignals(Object.values(rental.signals));
  return {
    demandContext: rental.demandContext,
    incomeEvidence: rental.incomeEvidence,
    guaranteeEvidence: rental.guaranteeEvidence,
    keyDataGaps: rental.keyDataGaps,
    readinessVerdict: rental.readinessVerdict,
    verdictRationale: rental.verdictRationale,
    signalsPresent: present,
    signalsTotal: total,
    scoreStatus: rental.rentalScore,
  };
}

function deriveLocationSummary(location: LocationIntelligence): PassportLocationSummary {
  const { present, total } = countSignals(Object.values(location.signals));
  return {
    locationIdentity: location.locationIdentity,
    beachProximity: location.beachProximity,
    lifestyleEvidence: location.lifestyleEvidence,
    keyDataGaps: location.keyDataGaps,
    readinessVerdict: location.readinessVerdict,
    verdictRationale: location.verdictRationale,
    signalsPresent: present,
    signalsTotal: total,
    scoreStatus: location.locationScore,
  };
}

// ---------------------------------------------------------------------------
// 6-9. Cross-foundation aggregation
// ---------------------------------------------------------------------------

function deriveDataCompleteness(
  trust: PassportTrustSummary,
  investment: PassportInvestmentSummary,
  rental: PassportRentalSummary,
  location: PassportLocationSummary,
): PassportDataCompleteness {
  const byFoundation: PassportCompletenessRow[] = [
    {
      key: "trust",
      label: FOUNDATION_LABEL.trust,
      signalsPresent: trust.signalsPresent,
      signalsTotal: trust.signalsTotal,
    },
    {
      key: "investment",
      label: FOUNDATION_LABEL.investment,
      signalsPresent: investment.signalsPresent,
      signalsTotal: investment.signalsTotal,
    },
    {
      key: "rental",
      label: FOUNDATION_LABEL.rental,
      signalsPresent: rental.signalsPresent,
      signalsTotal: rental.signalsTotal,
    },
    {
      key: "location",
      label: FOUNDATION_LABEL.location,
      signalsPresent: location.signalsPresent,
      signalsTotal: location.signalsTotal,
    },
  ];

  const signalsPresent = byFoundation.reduce((sum, row) => sum + row.signalsPresent, 0);
  const signalsTotal = byFoundation.reduce((sum, row) => sum + row.signalsTotal, 0);
  const percentComplete = signalsTotal > 0 ? Math.round((signalsPresent / signalsTotal) * 100) : 0;

  return { signalsPresent, signalsTotal, percentComplete, byFoundation };
}

function deriveCombinedGaps(
  trust: PassportTrustSummary,
  investment: PassportInvestmentSummary,
  rental: PassportRentalSummary,
  location: PassportLocationSummary,
): PassportCombinedGaps {
  const byFoundation: Record<PassportFoundationKey, string[]> = {
    trust: trust.keyDataGaps,
    investment: investment.keyDataGaps,
    rental: rental.keyDataGaps,
    location: location.keyDataGaps,
  };

  // Deterministic domain order, preserving each foundation's internal order.
  const order: PassportFoundationKey[] = ["trust", "investment", "rental", "location"];
  const combined = order.flatMap((key) =>
    byFoundation[key].map((gap) => `${FOUNDATION_LABEL[key]}: ${gap}`),
  );

  return { combined, byFoundation, totalGaps: combined.length };
}

/**
 * The overall verdict is DETERMINISTIC: the single most conservative (lowest on
 * the shared readiness scale) of the four foundation verdicts. Nothing is
 * averaged; no new rule is introduced.
 */
function deriveOverallVerdict(
  trust: PassportTrustSummary,
  investment: PassportInvestmentSummary,
  rental: PassportRentalSummary,
  location: PassportLocationSummary,
): PassportOverallVerdict {
  const byFoundation: PassportVerdictRow[] = [
    { key: "trust", label: FOUNDATION_LABEL.trust, readinessVerdict: trust.readinessVerdict },
    {
      key: "investment",
      label: FOUNDATION_LABEL.investment,
      readinessVerdict: investment.readinessVerdict,
    },
    { key: "rental", label: FOUNDATION_LABEL.rental, readinessVerdict: rental.readinessVerdict },
    {
      key: "location",
      label: FOUNDATION_LABEL.location,
      readinessVerdict: location.readinessVerdict,
    },
  ];

  const readinessVerdict = byFoundation.reduce<PassportReadinessVerdict>(
    (lowest, row) =>
      READINESS_ORDER[row.readinessVerdict] < READINESS_ORDER[lowest]
        ? row.readinessVerdict
        : lowest,
    "Ready for preliminary review",
  );

  const detail = byFoundation.map((row) => `${row.label}: ${row.readinessVerdict}`).join("; ");
  const rationale = `Overall readiness is the most conservative of the four foundation verdicts. ${detail}.`;

  return { readinessVerdict, rationale, byFoundation };
}

function deriveEvidenceCoverage(
  trust: PassportTrustSummary,
  investment: PassportInvestmentSummary,
  rental: PassportRentalSummary,
  location: PassportLocationSummary,
): PassportEvidenceCoverage {
  const foundations: PassportEvidenceRow[] = [
    {
      key: "trust",
      label: FOUNDATION_LABEL.trust,
      readinessVerdict: trust.readinessVerdict,
      signalsPresent: trust.signalsPresent,
      signalsTotal: trust.signalsTotal,
      source: "project.trust (foreverVerified, verdict, marketPosition, lastInspection, trustNote)",
    },
    {
      key: "investment",
      label: FOUNDATION_LABEL.investment,
      readinessVerdict: investment.readinessVerdict,
      signalsPresent: investment.signalsPresent,
      signalsTotal: investment.signalsTotal,
      source: "deriveInvestmentIntelligence(project)",
    },
    {
      key: "rental",
      label: FOUNDATION_LABEL.rental,
      readinessVerdict: rental.readinessVerdict,
      signalsPresent: rental.signalsPresent,
      signalsTotal: rental.signalsTotal,
      source: "deriveRentalIntelligence(project)",
    },
    {
      key: "location",
      label: FOUNDATION_LABEL.location,
      readinessVerdict: location.readinessVerdict,
      signalsPresent: location.signalsPresent,
      signalsTotal: location.signalsTotal,
      source: "deriveLocationIntelligence(project)",
    },
  ];

  const foundationsReady = foundations.filter(
    (row) => row.readinessVerdict === "Ready for preliminary review",
  ).length;

  return { foundations, foundationsReady, foundationsTotal: foundations.length };
}

// ---------------------------------------------------------------------------
// 10. Metadata
// ---------------------------------------------------------------------------

function deriveMetadata(
  project: ProjectDetail,
  identity: PassportProjectIdentity,
  options: DeriveForeverPassportOptions,
): PassportMetadata {
  return {
    schemaVersion: "1.0",
    passportVersion: "1.0",
    source: "advisory-intelligence-foundations",
    projectSlug: identity.projectSlug,
    projectName: identity.projectName,
    foundationsConsumed: [
      FOUNDATION_LABEL.trust,
      FOUNDATION_LABEL.investment,
      FOUNDATION_LABEL.rental,
      FOUNDATION_LABEL.location,
    ],
    generatedAt: hasText(options.generatedAt) ? options.generatedAt.trim() : NOT_AVAILABLE,
    lastInspection: orNotAvailable(project.trust.lastInspection),
    lastPriceUpdate: orNotAvailable(project.pricing.lastPriceUpdate),
  };
}

/**
 * Derive the Forever Passport for a project. Pure and deterministic: identical
 * `ProjectDetail` input (and identical options) yields identical output.
 *
 * The Passport AGGREGATES the existing Intelligence foundations — it calls each
 * foundation's own derivation exactly once and reads only verified
 * `project.trust` fields for the Trust summary. It performs no recalculation of
 * raw ProjectDetail and introduces no scoring engine.
 */
export function deriveForeverPassport(
  project: ProjectDetail,
  options: DeriveForeverPassportOptions = {},
): ForeverPassport {
  // Consume the existing derivation layers — never recalculate their facts.
  const investmentIntelligence = deriveInvestmentIntelligence(project);
  const rentalIntelligence = deriveRentalIntelligence(project);
  const locationIntelligence = deriveLocationIntelligence(project);

  const identity = deriveIdentity(project);
  const trust = deriveTrustSummary(project);
  const investment = deriveInvestmentSummary(investmentIntelligence);
  const rental = deriveRentalSummary(rentalIntelligence);
  const location = deriveLocationSummary(locationIntelligence);

  const dataCompleteness = deriveDataCompleteness(trust, investment, rental, location);
  const combinedGaps = deriveCombinedGaps(trust, investment, rental, location);
  const overallVerdict = deriveOverallVerdict(trust, investment, rental, location);
  const evidenceCoverage = deriveEvidenceCoverage(trust, investment, rental, location);
  const metadata = deriveMetadata(project, identity, options);

  return {
    identity,
    trust,
    investment,
    rental,
    location,
    dataCompleteness,
    combinedGaps,
    overallVerdict,
    evidenceCoverage,
    metadata,
  };
}
