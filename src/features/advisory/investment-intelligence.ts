import type {
  ProjectDetail,
  ProjectDetailInvestmentRow,
  ProjectDetailUnit,
} from "@/features/project-detail/project-detail-types";

/**
 * Investment Intelligence — Foundation layer (Sprint RC2.1).
 *
 * A deterministic, evidence-only derivation over the EXISTING `ProjectDetail`
 * view model. It reports what investment information the verified project record
 * can currently support, and — just as importantly — what it cannot.
 *
 * Hard rules honoured here (see the module tests for the guarantees):
 *  - Every field is derived strictly from existing `ProjectDetail` data.
 *  - Nothing is fabricated: no yields, ROI, occupancy, growth, market averages,
 *    or numeric scores are invented. Missing data renders as `NOT_AVAILABLE`.
 *  - `trust.trustScore` is NEVER reused as an investment or match score.
 *  - No numeric Investment Score is produced. No approved, evidence-backed
 *    calculation rule exists in the repository, so the score field is always
 *    `INVESTMENT_SCORE_UNAVAILABLE`.
 *  - Identical input always produces identical output (pure function).
 */

/** Rendered whenever a field cannot be derived from verified data. */
export const NOT_AVAILABLE = "Not available" as const;

/**
 * Rendered in place of a numeric Investment Score. This foundation sprint
 * intentionally ships no scoring engine; there is no approved, evidence-backed
 * calculation rule in the repository to derive one from.
 */
export const INVESTMENT_SCORE_UNAVAILABLE = "Investment score not available" as const;

/** Conservative, deterministic readiness verdicts. Ordered low → high. */
export type InvestmentReadinessVerdict =
  | "Insufficient verified data"
  | "More evidence required"
  | "Ready for preliminary review";

/**
 * The exact boolean evidence signals that drive the readiness verdict. Exposed
 * so the verdict is fully explainable and directly assertable in tests.
 */
export interface InvestmentReadinessSignals {
  /** A concrete entry price exists (project starting price, unit price, or range). */
  hasEntryPrice: boolean;
  /** A construction / development status is on record. */
  hasConstructionContext: boolean;
  /** A developer record is linked to the project. */
  hasDeveloperContext: boolean;
  /** At least one unit is on record. */
  hasUnitInventory: boolean;
  /** The price has been independently verified (not merely listed). */
  hasVerifiedPrice: boolean;
  /** Concrete income evidence exists (rent figures or a rental guarantee). */
  hasIncomeEvidence: boolean;
}

/** Fully-derived, presentational-ready Investment Intelligence for one project. */
export interface InvestmentIntelligence {
  entryPrice: string;
  availableUnitRange: string;
  priceVerificationStatus: string;
  rentalEvidence: string;
  investmentEvidence: string;
  constructionContext: string;
  developerContext: string;
  liquidityEvidence: string;
  /** Named data gaps, deterministically ordered. Empty when nothing is missing. */
  keyDataGaps: string[];
  /** Always `INVESTMENT_SCORE_UNAVAILABLE` in this foundation sprint. */
  investmentScore: typeof INVESTMENT_SCORE_UNAVAILABLE;
  readinessVerdict: InvestmentReadinessVerdict;
  /** Plain-language, deterministic explanation of the verdict. */
  verdictRationale: string;
  /** The raw signals behind the verdict, for transparency and testing. */
  signals: InvestmentReadinessSignals;
}

const AVAILABLE_STATUSES = new Set(["available", "selling", "for_sale", "for sale"]);
const SOLD_STATUSES = new Set(["sold", "sold_out", "sold out", "reserved"]);

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Deterministic THB formatting with a fixed locale — never locale-dependent. */
function formatTHB(value: number): string {
  return `THB ${value.toLocaleString("en-US")}`;
}

/** The lowest priced, non-zero effective price for a unit (discount wins). */
function effectiveUnitPrice(unit: ProjectDetailUnit): number | null {
  const discounted = unit.discountedPriceTHB ?? 0;
  const base = unit.basePriceTHB ?? 0;
  const candidates = [discounted, base].filter((price) => price > 0);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

function isAvailable(unit: ProjectDetailUnit): boolean {
  return AVAILABLE_STATUSES.has(unit.availabilityStatus.trim().toLowerCase());
}

function isSold(unit: ProjectDetailUnit): boolean {
  return SOLD_STATUSES.has(unit.availabilityStatus.trim().toLowerCase());
}

/** An investment row carries substance if any income/return figure is present. */
function investmentRowHasSubstance(row: ProjectDetailInvestmentRow): boolean {
  return (
    row.expectedMonthlyRent != null ||
    row.expectedYearlyRent != null ||
    row.expectedDailyRate != null ||
    row.occupancyRate != null ||
    row.annualRoiPercent != null ||
    row.guaranteedRentalPercent != null
  );
}

/** A row carries concrete rent evidence specifically (not just a return %). */
function investmentRowHasRent(row: ProjectDetailInvestmentRow): boolean {
  return (
    row.expectedMonthlyRent != null ||
    row.expectedYearlyRent != null ||
    row.expectedDailyRate != null
  );
}

function deriveEntryPrice(project: ProjectDetail): string {
  const { startingPriceTHB, priceRange } = project.pricing;
  if (startingPriceTHB > 0) return `From ${formatTHB(startingPriceTHB)}`;

  const unitPrices = project.units
    .map(effectiveUnitPrice)
    .filter((price): price is number => price != null);
  if (unitPrices.length > 0) return `From ${formatTHB(Math.min(...unitPrices))}`;

  if (hasText(priceRange)) return priceRange;
  return NOT_AVAILABLE;
}

function numericRange(values: Array<number | null>, unit: string): string | null {
  const clean = values.filter((value): value is number => value != null && value > 0);
  if (clean.length === 0) return null;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  return min === max ? `${min} ${unit}` : `${min}–${max} ${unit}`;
}

function deriveAvailableUnitRange(project: ProjectDetail): string {
  const units = project.units;
  if (units.length > 0) {
    const availableCount = units.filter(isAvailable).length;
    const bedRange = numericRange(
      units.map((unit) => unit.bedrooms),
      "bed",
    );
    const sizeRange = numericRange(
      units.map((unit) => unit.sizeSqm),
      "sqm",
    );
    const detail = [bedRange, sizeRange].filter(hasText).join(", ");
    const headline =
      availableCount > 0
        ? `${availableCount} of ${units.length} units available`
        : `0 of ${units.length} units available`;
    return detail ? `${headline} (${detail})` : headline;
  }

  const fallback = [project.core.beds, project.core.area].filter(hasText).join(", ");
  return fallback || NOT_AVAILABLE;
}

function derivePriceVerificationStatus(project: ProjectDetail, hasEntryPrice: boolean): string {
  const { verifiedPrice, lastPriceUpdate } = project.pricing;
  if (hasText(verifiedPrice)) {
    const asOf = hasText(lastPriceUpdate) ? ` (as of ${lastPriceUpdate})` : "";
    return `Verified — ${verifiedPrice}${asOf}`;
  }
  if (hasEntryPrice) return "Listed price, not independently verified";
  return NOT_AVAILABLE;
}

function deriveRentalEvidence(project: ProjectDetail): string {
  const guaranteeUnits = project.units.filter((unit) => hasText(unit.rentalGuarantee)).length;
  const rentRows = project.investment.rows.filter(investmentRowHasRent).length;

  const parts: string[] = [];
  if (rentRows > 0) parts.push(`${rentRows} investment record(s) with rent figures`);
  if (guaranteeUnits > 0) parts.push(`${guaranteeUnits} unit(s) with a rental guarantee`);

  return parts.length > 0 ? parts.join("; ") : NOT_AVAILABLE;
}

function deriveInvestmentEvidence(project: ProjectDetail): string {
  const rows = project.investment.rows.filter(investmentRowHasSubstance).length;
  if (rows > 0) return `${rows} structured investment record(s) on file`;
  return NOT_AVAILABLE;
}

function deriveConstructionContext(project: ProjectDetail): string {
  return hasText(project.core.constructionStatus) ? project.core.constructionStatus : NOT_AVAILABLE;
}

function deriveDeveloperContext(project: ProjectDetail): string {
  const developer = project.developer;
  if (!developer || !hasText(developer.name)) return NOT_AVAILABLE;
  return hasText(developer.description)
    ? `${developer.name} — ${developer.description}`
    : developer.name;
}

function deriveLiquidityEvidence(project: ProjectDetail): string {
  const units = project.units;
  if (units.length > 0) {
    const available = units.filter(isAvailable).length;
    const sold = units.filter(isSold).length;
    return `${units.length} units on record; ${available} available, ${sold} sold`;
  }
  if (hasText(project.core.status)) return `Sales status: ${project.core.status}`;
  return NOT_AVAILABLE;
}

function deriveKeyDataGaps(
  signals: InvestmentReadinessSignals,
  hasInvestmentRecords: boolean,
): string[] {
  const gaps: string[] = [];
  if (!signals.hasEntryPrice) gaps.push("Entry price");
  if (!signals.hasVerifiedPrice) gaps.push("Verified price confirmation");
  if (!signals.hasUnitInventory) gaps.push("Unit inventory");
  if (!signals.hasIncomeEvidence) gaps.push("Rental / income evidence");
  if (!hasInvestmentRecords) gaps.push("Structured investment data");
  if (!signals.hasConstructionContext) gaps.push("Construction status");
  if (!signals.hasDeveloperContext) gaps.push("Developer record");
  return gaps;
}

/**
 * Verdict rules — deterministic and conservative.
 *
 * Foundational signals (all three required to consider a preliminary review):
 *   F1 hasEntryPrice · F2 hasConstructionContext · F3 hasDeveloperContext
 *
 * Depth signals (investment substance):
 *   D1 hasUnitInventory · D2 hasVerifiedPrice · D3 hasIncomeEvidence
 *
 * Rules, in order:
 *   1. Any foundational signal missing               → "Insufficient verified data"
 *   2. All foundational present AND ≥ 2 depth signals → "Ready for preliminary review"
 *   3. All foundational present AND < 2 depth signals → "More evidence required"
 */
function deriveVerdict(signals: InvestmentReadinessSignals): {
  readinessVerdict: InvestmentReadinessVerdict;
  verdictRationale: string;
} {
  const foundationalPresent =
    signals.hasEntryPrice && signals.hasConstructionContext && signals.hasDeveloperContext;
  const depthCount = [
    signals.hasUnitInventory,
    signals.hasVerifiedPrice,
    signals.hasIncomeEvidence,
  ].filter(Boolean).length;

  if (!foundationalPresent) {
    const missing: string[] = [];
    if (!signals.hasEntryPrice) missing.push("entry price");
    if (!signals.hasConstructionContext) missing.push("construction status");
    if (!signals.hasDeveloperContext) missing.push("developer record");
    return {
      readinessVerdict: "Insufficient verified data",
      verdictRationale: `Missing foundational evidence: ${missing.join(", ")}.`,
    };
  }

  if (depthCount >= 2) {
    return {
      readinessVerdict: "Ready for preliminary review",
      verdictRationale: `Foundational evidence present with ${depthCount} of 3 supporting signals (unit inventory, verified price, income evidence).`,
    };
  }

  return {
    readinessVerdict: "More evidence required",
    verdictRationale: `Foundational evidence present but only ${depthCount} of 3 supporting signals (unit inventory, verified price, income evidence).`,
  };
}

/**
 * Derive the Investment Intelligence view model for a project. Pure and
 * deterministic: identical `ProjectDetail` input yields identical output.
 */
export function deriveInvestmentIntelligence(project: ProjectDetail): InvestmentIntelligence {
  const entryPrice = deriveEntryPrice(project);
  const hasEntryPrice = entryPrice !== NOT_AVAILABLE;

  const priceVerificationStatus = derivePriceVerificationStatus(project, hasEntryPrice);
  const rentalEvidence = deriveRentalEvidence(project);
  const investmentEvidence = deriveInvestmentEvidence(project);
  const constructionContext = deriveConstructionContext(project);
  const developerContext = deriveDeveloperContext(project);
  const liquidityEvidence = deriveLiquidityEvidence(project);
  const availableUnitRange = deriveAvailableUnitRange(project);

  const signals: InvestmentReadinessSignals = {
    hasEntryPrice,
    hasConstructionContext: constructionContext !== NOT_AVAILABLE,
    hasDeveloperContext: developerContext !== NOT_AVAILABLE,
    hasUnitInventory: project.units.length > 0,
    hasVerifiedPrice: hasText(project.pricing.verifiedPrice),
    hasIncomeEvidence: rentalEvidence !== NOT_AVAILABLE,
  };

  const keyDataGaps = deriveKeyDataGaps(signals, investmentEvidence !== NOT_AVAILABLE);
  const { readinessVerdict, verdictRationale } = deriveVerdict(signals);

  return {
    entryPrice,
    availableUnitRange,
    priceVerificationStatus,
    rentalEvidence,
    investmentEvidence,
    constructionContext,
    developerContext,
    liquidityEvidence,
    keyDataGaps,
    investmentScore: INVESTMENT_SCORE_UNAVAILABLE,
    readinessVerdict,
    verdictRationale,
    signals,
  };
}
