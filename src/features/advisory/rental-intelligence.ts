import type {
  ProjectDetail,
  ProjectDetailInvestmentRow,
  ProjectDetailUnit,
} from "@/features/project-detail/project-detail-types";

import { NOT_AVAILABLE } from "./investment-intelligence";

/**
 * Rental Intelligence — Foundation layer (Sprint RC2.2).
 *
 * A deterministic, evidence-only derivation over the EXISTING `ProjectDetail`
 * view model. It reports what rental information the verified project record can
 * currently support, and — just as importantly — what it cannot. It follows
 * exactly the same architectural principles as the Investment Intelligence
 * foundation (`./investment-intelligence`).
 *
 * Hard rules honoured here (see the module tests for the guarantees):
 *  - Every field is derived strictly from existing `ProjectDetail` data.
 *  - Nothing is fabricated: no occupancy, ADR, ROI, revenue, yield, rental
 *    demand, seasonality, competition, or numeric scores are invented. Missing
 *    data renders as `NOT_AVAILABLE`.
 *  - Sensitive rental figures (occupancy %, ADR, ROI, rent amounts) are never
 *    surfaced as raw numbers; only the PRESENCE of verified records is reported,
 *    exactly as the Investment Intelligence layer reports evidence counts.
 *  - `trust.trustScore` is NEVER reused as a rental or match score.
 *  - No numeric Rental Score is produced. No approved, evidence-backed
 *    calculation rule exists in the repository, so the score field is always
 *    `RENTAL_SCORE_UNAVAILABLE`.
 *  - Seasonality and competition have no verified `ProjectDetail` source, so
 *    they are always reported as `NOT_AVAILABLE` — never estimated.
 *  - Identical input always produces identical output (pure function).
 *
 * `NOT_AVAILABLE` is intentionally reused from the Investment Intelligence
 * module so both foundations render the exact same sentinel.
 */

/**
 * Rendered in place of a numeric Rental Score. This foundation sprint
 * intentionally ships no scoring engine; there is no approved, evidence-backed
 * calculation rule in the repository to derive one from.
 */
export const RENTAL_SCORE_UNAVAILABLE = "Rental score not available" as const;

/** Conservative, deterministic readiness verdicts. Ordered low → high. */
export type RentalReadinessVerdict =
  | "Insufficient verified data"
  | "More evidence required"
  | "Ready for preliminary review";

/**
 * The exact boolean evidence signals that drive the readiness verdict. Exposed
 * so the verdict is fully explainable and directly assertable in tests.
 */
export interface RentalReadinessSignals {
  /** A recorded rental-demand rating exists on the project. */
  hasDemandSignal: boolean;
  /** At least one investment record carries a concrete rent figure. */
  hasIncomeEvidence: boolean;
  /** At least one investment record carries occupancy data. */
  hasOccupancyEvidence: boolean;
  /** At least one investment record carries an ROI figure. */
  hasReturnEvidence: boolean;
  /** A rental guarantee exists (on a unit or as a structured record). */
  hasGuarantee: boolean;
  /** A rental management company is named on record. */
  hasManagement: boolean;
}

/** Fully-derived, presentational-ready Rental Intelligence for one project. */
export interface RentalIntelligence {
  demandContext: string;
  incomeEvidence: string;
  occupancyEvidence: string;
  returnEvidence: string;
  guaranteeEvidence: string;
  managementContext: string;
  /** No verified source exists — always `NOT_AVAILABLE`. Never estimated. */
  seasonalityEvidence: string;
  /** No verified source exists — always `NOT_AVAILABLE`. Never estimated. */
  competitionEvidence: string;
  /** Named data gaps, deterministically ordered. Empty when nothing is missing. */
  keyDataGaps: string[];
  /** Always `RENTAL_SCORE_UNAVAILABLE` in this foundation sprint. */
  rentalScore: typeof RENTAL_SCORE_UNAVAILABLE;
  readinessVerdict: RentalReadinessVerdict;
  /** Plain-language, deterministic explanation of the verdict. */
  verdictRationale: string;
  /** The raw signals behind the verdict, for transparency and testing. */
  signals: RentalReadinessSignals;
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** A row carries concrete rent evidence (a rate/amount, not just a return %). */
function investmentRowHasRent(row: ProjectDetailInvestmentRow): boolean {
  return (
    row.expectedMonthlyRent != null ||
    row.expectedYearlyRent != null ||
    row.expectedDailyRate != null
  );
}

/** A structured rental guarantee on an investment row. */
function investmentRowHasGuarantee(row: ProjectDetailInvestmentRow): boolean {
  return row.guaranteedRentalPercent != null || row.guaranteeYears != null;
}

/** Distinct, cleaned, first-seen-ordered list of strings. */
function distinctText(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (hasText(raw)) {
      const value = raw.trim();
      if (!seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    }
  }
  return out;
}

function deriveDemandContext(project: ProjectDetail): string {
  return hasText(project.investment.rentalDemand)
    ? `Recorded rental demand: ${project.investment.rentalDemand.trim()}`
    : NOT_AVAILABLE;
}

function deriveIncomeEvidence(project: ProjectDetail): string {
  const rows = project.investment.rows.filter(investmentRowHasRent).length;
  return rows > 0 ? `${rows} investment record(s) with rent figures` : NOT_AVAILABLE;
}

function deriveOccupancyEvidence(project: ProjectDetail): string {
  const rows = project.investment.rows.filter((row) => row.occupancyRate != null).length;
  return rows > 0 ? `${rows} investment record(s) with occupancy data` : NOT_AVAILABLE;
}

function deriveReturnEvidence(project: ProjectDetail): string {
  const rows = project.investment.rows.filter((row) => row.annualRoiPercent != null).length;
  return rows > 0 ? `${rows} investment record(s) with ROI data` : NOT_AVAILABLE;
}

function deriveGuaranteeEvidence(project: ProjectDetail): string {
  const guaranteeUnits = project.units.filter((unit) => hasText(unit.rentalGuarantee)).length;
  const guaranteeRows = project.investment.rows.filter(investmentRowHasGuarantee).length;

  const parts: string[] = [];
  if (guaranteeUnits > 0) parts.push(`${guaranteeUnits} unit(s) with a rental guarantee`);
  if (guaranteeRows > 0) parts.push(`${guaranteeRows} structured rental-guarantee record(s)`);

  return parts.length > 0 ? parts.join("; ") : NOT_AVAILABLE;
}

function deriveManagementContext(project: ProjectDetail): string {
  const companies = distinctText(project.investment.rows.map((row) => row.managementCompany));
  return companies.length > 0 ? `Managed by ${companies.join(", ")}` : NOT_AVAILABLE;
}

function deriveKeyDataGaps(signals: RentalReadinessSignals): string[] {
  const gaps: string[] = [];
  if (!signals.hasDemandSignal) gaps.push("Rental demand");
  if (!signals.hasIncomeEvidence) gaps.push("Rental income evidence");
  if (!signals.hasManagement) gaps.push("Management company");
  if (!signals.hasOccupancyEvidence) gaps.push("Occupancy data");
  if (!signals.hasReturnEvidence) gaps.push("ROI data");
  if (!signals.hasGuarantee) gaps.push("Rental guarantee");
  return gaps;
}

/**
 * Verdict rules — deterministic and conservative.
 *
 * Foundational signals (all three required to consider a preliminary review):
 *   F1 hasIncomeEvidence · F2 hasDemandSignal · F3 hasManagement
 *
 * Depth signals (rental substance):
 *   D1 hasOccupancyEvidence · D2 hasReturnEvidence · D3 hasGuarantee
 *
 * Rules, in order:
 *   1. Any foundational signal missing               → "Insufficient verified data"
 *   2. All foundational present AND ≥ 2 depth signals → "Ready for preliminary review"
 *   3. All foundational present AND < 2 depth signals → "More evidence required"
 */
function deriveVerdict(signals: RentalReadinessSignals): {
  readinessVerdict: RentalReadinessVerdict;
  verdictRationale: string;
} {
  const foundationalPresent =
    signals.hasIncomeEvidence && signals.hasDemandSignal && signals.hasManagement;
  const depthCount = [
    signals.hasOccupancyEvidence,
    signals.hasReturnEvidence,
    signals.hasGuarantee,
  ].filter(Boolean).length;

  if (!foundationalPresent) {
    const missing: string[] = [];
    if (!signals.hasIncomeEvidence) missing.push("rent evidence");
    if (!signals.hasDemandSignal) missing.push("rental demand");
    if (!signals.hasManagement) missing.push("management company");
    return {
      readinessVerdict: "Insufficient verified data",
      verdictRationale: `Missing foundational evidence: ${missing.join(", ")}.`,
    };
  }

  if (depthCount >= 2) {
    return {
      readinessVerdict: "Ready for preliminary review",
      verdictRationale: `Foundational evidence present with ${depthCount} of 3 supporting signals (occupancy data, ROI data, rental guarantee).`,
    };
  }

  return {
    readinessVerdict: "More evidence required",
    verdictRationale: `Foundational evidence present but only ${depthCount} of 3 supporting signals (occupancy data, ROI data, rental guarantee).`,
  };
}

/**
 * Derive the Rental Intelligence view model for a project. Pure and
 * deterministic: identical `ProjectDetail` input yields identical output.
 */
export function deriveRentalIntelligence(project: ProjectDetail): RentalIntelligence {
  const demandContext = deriveDemandContext(project);
  const incomeEvidence = deriveIncomeEvidence(project);
  const occupancyEvidence = deriveOccupancyEvidence(project);
  const returnEvidence = deriveReturnEvidence(project);
  const guaranteeEvidence = deriveGuaranteeEvidence(project);
  const managementContext = deriveManagementContext(project);

  const signals: RentalReadinessSignals = {
    hasDemandSignal: demandContext !== NOT_AVAILABLE,
    hasIncomeEvidence: incomeEvidence !== NOT_AVAILABLE,
    hasOccupancyEvidence: occupancyEvidence !== NOT_AVAILABLE,
    hasReturnEvidence: returnEvidence !== NOT_AVAILABLE,
    hasGuarantee: guaranteeEvidence !== NOT_AVAILABLE,
    hasManagement: managementContext !== NOT_AVAILABLE,
  };

  const keyDataGaps = deriveKeyDataGaps(signals);
  const { readinessVerdict, verdictRationale } = deriveVerdict(signals);

  return {
    demandContext,
    incomeEvidence,
    occupancyEvidence,
    returnEvidence,
    guaranteeEvidence,
    managementContext,
    // No verified ProjectDetail source exists for these — never estimated.
    seasonalityEvidence: NOT_AVAILABLE,
    competitionEvidence: NOT_AVAILABLE,
    keyDataGaps,
    rentalScore: RENTAL_SCORE_UNAVAILABLE,
    readinessVerdict,
    verdictRationale,
    signals,
  };
}
