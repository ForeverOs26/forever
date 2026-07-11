import type { ProjectDetail } from "@/features/project-detail/project-detail-types";

import { NOT_AVAILABLE } from "./investment-intelligence";
import {
  deriveForeverPassport,
  type ForeverPassport,
  type PassportFoundationKey,
  type PassportReadinessVerdict,
} from "./forever-passport";
import { deriveProjectSummary, type ProjectSummary } from "./project-summary";

/**
 * Project Comparison — the first comparison engine for Forever Advisor (RC2.6).
 *
 * This is NOT a new intelligence foundation. It is a thin, descriptive
 * comparison layer built strictly on top of the already-derived outputs:
 *
 *   Project A ─┐
 *              ├─→ deriveForeverPassport() → deriveProjectSummary()
 *   Project B ─┘
 *                     ↓
 *              deriveProjectComparison()   ← this layer (pure, deterministic)
 *                     ↓
 *              Advisory Workspace
 *
 * Hard rules honoured here (locked down by the module tests):
 *  - It introduces NO new scoring engine and calculates NO new rating, ranking,
 *    tie-breaker, ROI, yield, appreciation, or occupancy value. It never converts
 *    a qualitative verdict into a number.
 *  - Every compared value is REUSED verbatim from the already-derived Forever
 *    Passport and Project Summary. No derivation logic is duplicated and no raw
 *    ProjectDetail metric is recalculated here.
 *  - Comparison is DESCRIPTIVE, never a hidden-value ranking. "Project A
 *    currently has more verified rental evidence" — never "Project A scores
 *    higher". The only comparative statements made are grounded in (a) the
 *    documented, public readiness scale, (b) counts of present evidence signals
 *    (data presence, never quality), and (c) counts of recorded data gaps. Data
 *    coverage never implies quality.
 *  - Anything not supported by verified data renders as the shared
 *    `NOT_AVAILABLE` sentinel. Nothing is fabricated or invented.
 *  - Strengths, considerations, buyer-profile notes, and data gaps are
 *    de-duplicated and kept in a stable, deterministic order.
 *  - Identical input always produces identical output (pure function). The only
 *    non-deterministic value — the generation timestamp — is never computed
 *    internally; it is surfaced only when the caller supplies it.
 */

/** The single side identifier used across the comparison. */
export type ComparisonSide = "a" | "b";

/**
 * The comparative lead for a purely descriptive, data-coverage measure. `"equal"`
 * means neither side currently carries more coverage. This is NEVER a quality
 * judgement — it reflects evidence presence or documented readiness stage only.
 */
export type ComparisonLead = "a" | "b" | "equal";

/** Descriptive status of one compared evidence field. */
export type ComparisonRowStatus =
  /** Both projects carry the same verified value. */
  | "identical"
  /** Both projects carry a value, and the values differ. */
  | "different"
  /** Only Project A carries a verified value. */
  | "present-in-a"
  /** Only Project B carries a verified value. */
  | "present-in-b"
  /** Neither project carries a verified value. */
  | "absent-in-both";

/** One compared evidence field, shown side by side. */
export interface ComparisonRow {
  key: string;
  label: string;
  /** Project A's verified value, or `NOT_AVAILABLE`. */
  a: string;
  /** Project B's verified value, or `NOT_AVAILABLE`. */
  b: string;
  status: ComparisonRowStatus;
}

/**
 * A set comparison of two deduplicated string lists (strengths, considerations,
 * buyer-profile notes, or data gaps). Buckets never overlap.
 */
export interface ComparisonSetDiff {
  /** Present in both projects (Project A's casing/order preserved). */
  shared: string[];
  /** Present only in Project A. */
  onlyA: string[];
  /** Present only in Project B. */
  onlyB: string[];
}

/** Identity of one compared project (reused from the Passport identity). */
export interface ComparisonProjectIdentity {
  projectName: string;
  projectSlug: string;
  propertyType: string;
  location: string;
  developerName: string;
  constructionStatus: string;
}

/** 1. Compared Projects — who is being compared. */
export interface ComparedProjects {
  a: ComparisonProjectIdentity;
  b: ComparisonProjectIdentity;
  /** True when both sides resolve to the same verified record (same slug). */
  sameProject: boolean;
  /** Controlled note describing the comparison pairing. */
  note: string;
}

/**
 * A high-level descriptive read of the comparison. Every statement is grounded
 * only in the documented readiness scale, present-evidence counts, or recorded
 * gap counts — never in a fabricated score.
 */
export interface ComparisonHeadline {
  statements: string[];
}

/** 2. Passport comparison — reuses overall verdict, readiness, signals, gaps. */
export interface PassportComparison {
  /** The Passport overall readiness verdict for each side, reused verbatim. */
  overallReadiness: {
    a: PassportReadinessVerdict;
    b: PassportReadinessVerdict;
  };
  /** Verified evidence-signal presence per side (data presence, not quality). */
  dataPresence: {
    a: { present: number; total: number };
    b: { present: number; total: number };
  };
  /** Combined, domain-prefixed key data gaps compared as a set. */
  gaps: ComparisonSetDiff;
}

/** 3-6. A per-domain field-level comparison. */
export interface DomainComparison {
  rows: ComparisonRow[];
}

/** 9. Buyer profile comparison — reuses only existing buyer-profile outputs. */
export interface BuyerProfileComparison {
  availability: { a: boolean; b: boolean };
  diff: ComparisonSetDiff;
  /** Reused verbatim from the Project Summary buyer-profile basis. */
  basis: string;
}

/**
 * 10. Decision readiness comparison — reuses the Passport readiness verdict only.
 * `lead` is the side further along the documented, public readiness scale. It is
 * NOT a computed score and NOT a project-quality judgement.
 */
export interface ReadinessComparison {
  a: PassportReadinessVerdict;
  b: PassportReadinessVerdict;
  rationaleA: string;
  rationaleB: string;
  lead: ComparisonLead;
  note: string;
}

/** One foundation's evidence-coverage counts for both sides. */
export interface EvidenceCompletenessRow {
  key: PassportFoundationKey;
  label: string;
  aPresent: number;
  bPresent: number;
  total: number;
  lead: ComparisonLead;
}

/**
 * 11. Evidence completeness comparison — compares data coverage only. Counts of
 * present evidence signals are a DATA-PRESENCE measure; they never imply quality.
 */
export interface EvidenceCompletenessComparison {
  byFoundation: EvidenceCompletenessRow[];
  overall: {
    aPresent: number;
    bPresent: number;
    total: number;
    lead: ComparisonLead;
  };
  note: string;
}

/** Provenance metadata — never fabricated. */
export interface ProjectComparisonMetadata {
  schemaVersion: "1.0";
  comparisonVersion: "1.0";
  /** Names the comparison source — the Passport + Project Summary layers. */
  source: "advisory-project-comparison";
  /** The two compared project slugs, in [A, B] order. */
  projects: [string, string];
  /** The already-derived outputs this comparison consumes. */
  consumes: string[];
  /**
   * Generation timestamp. Never computed inside the pure derivation; it is the
   * caller-supplied value, or `NOT_AVAILABLE` when none is supplied.
   */
  generatedAt: string;
}

/** The complete, presentational-ready Project Comparison for two projects. */
export interface ProjectComparison {
  comparedProjects: ComparedProjects;
  headline: ComparisonHeadline;
  passport: PassportComparison;
  investment: DomainComparison;
  rental: DomainComparison;
  location: DomainComparison;
  trust: DomainComparison;
  strengths: ComparisonSetDiff;
  considerations: ComparisonSetDiff;
  buyerProfile: BuyerProfileComparison;
  decisionReadiness: ReadinessComparison;
  evidenceCompleteness: EvidenceCompletenessComparison;
  metadata: ProjectComparisonMetadata;
}

/**
 * One side of the comparison. The Passport and Summary are OPTIONAL: when they
 * are omitted the canonical `deriveForeverPassport` / `deriveProjectSummary`
 * derivations are reused (never re-implemented), so the comparison always
 * consumes the same derived output the rest of the Advisory Workspace uses.
 */
export interface ComparisonProjectInput {
  project: ProjectDetail;
  /** Already-derived Forever Passport. Reused via `deriveForeverPassport` when omitted. */
  passport?: ForeverPassport;
  /** Already-derived Project Summary. Reused via `deriveProjectSummary` when omitted. */
  summary?: ProjectSummary;
}

/** Inputs for the derivation. Kept as an options object per the RC2.6 spec. */
export interface DeriveProjectComparisonInput {
  a: ComparisonProjectInput;
  b: ComparisonProjectInput;
  /** Caller-supplied generation timestamp. Surfaced verbatim in metadata. */
  generatedAt?: string;
}

const FOUNDATION_LABEL: Record<PassportFoundationKey, string> = {
  trust: "Trust Intelligence",
  investment: "Investment Intelligence",
  rental: "Rental Intelligence",
  location: "Location Intelligence",
};

/**
 * The documented, public advisory readiness scale, ordered low → high. This
 * mirrors the Passport's own documented scale exactly; it is NOT a new score.
 * It is used only to describe which side is further along that stated scale.
 */
const READINESS_SCALE: PassportReadinessVerdict[] = [
  "Insufficient verified data",
  "More evidence required",
  "Ready for preliminary review",
];

function readinessRank(verdict: PassportReadinessVerdict): number {
  return READINESS_SCALE.indexOf(verdict);
}

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
 * order and dropping empties.
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

/**
 * Compare two deduplicated string lists into shared / only-A / only-B buckets.
 * Buckets never overlap. Shared and only-A keep Project A's order and casing;
 * only-B keeps Project B's order. Deterministic for identical input.
 */
function setDiff(aItems: string[], bItems: string[]): ComparisonSetDiff {
  const aClean = dedupe(aItems);
  const bClean = dedupe(bItems);
  const aKeys = new Set(aClean.map((v) => v.toLowerCase()));
  const bKeys = new Set(bClean.map((v) => v.toLowerCase()));

  return {
    shared: aClean.filter((v) => bKeys.has(v.toLowerCase())),
    onlyA: aClean.filter((v) => !bKeys.has(v.toLowerCase())),
    onlyB: bClean.filter((v) => !aKeys.has(v.toLowerCase())),
  };
}

/** Build one side-by-side comparison row, deriving its descriptive status. */
function compareRow(
  key: string,
  label: string,
  aRaw: string | null | undefined,
  bRaw: string | null | undefined,
): ComparisonRow {
  const a = present(aRaw);
  const b = present(bRaw);

  let status: ComparisonRowStatus;
  if (a !== null && b !== null) {
    status = a.toLowerCase() === b.toLowerCase() ? "identical" : "different";
  } else if (a !== null) {
    status = "present-in-a";
  } else if (b !== null) {
    status = "present-in-b";
  } else {
    status = "absent-in-both";
  }

  return { key, label, a: a ?? NOT_AVAILABLE, b: b ?? NOT_AVAILABLE, status };
}

/** Which side carries the larger count, or `"equal"`. Never a quality claim. */
function leadByCount(aCount: number, bCount: number): ComparisonLead {
  if (aCount > bCount) return "a";
  if (bCount > aCount) return "b";
  return "equal";
}

// ---------------------------------------------------------------------------
// 1. Compared Projects
// ---------------------------------------------------------------------------

function toIdentity(passport: ForeverPassport): ComparisonProjectIdentity {
  const { identity } = passport;
  return {
    projectName: identity.projectName,
    projectSlug: identity.projectSlug,
    propertyType: identity.propertyType,
    location: identity.location,
    developerName: identity.developerName,
    constructionStatus: identity.constructionStatus,
  };
}

function deriveComparedProjects(a: ForeverPassport, b: ForeverPassport): ComparedProjects {
  const identityA = toIdentity(a);
  const identityB = toIdentity(b);
  const sameProject =
    present(identityA.projectSlug) !== null &&
    identityA.projectSlug.toLowerCase() === identityB.projectSlug.toLowerCase();

  const nameA = present(identityA.projectName) ?? "Project A";
  const nameB = present(identityB.projectName) ?? "Project B";
  const note = sameProject
    ? `Both sides reference the same verified record (${nameA}); every field is identical.`
    : `Comparing ${nameA} with ${nameB} using already-verified evidence only.`;

  return { a: identityA, b: identityB, sameProject, note };
}

// ---------------------------------------------------------------------------
// 2. Passport comparison
// ---------------------------------------------------------------------------

function derivePassportComparison(a: ForeverPassport, b: ForeverPassport): PassportComparison {
  return {
    overallReadiness: {
      a: a.overallVerdict.readinessVerdict,
      b: b.overallVerdict.readinessVerdict,
    },
    dataPresence: {
      a: { present: a.dataCompleteness.signalsPresent, total: a.dataCompleteness.signalsTotal },
      b: { present: b.dataCompleteness.signalsPresent, total: b.dataCompleteness.signalsTotal },
    },
    gaps: setDiff(a.combinedGaps.combined, b.combinedGaps.combined),
  };
}

// ---------------------------------------------------------------------------
// 3-6. Per-domain field comparisons (reuse the Passport foundation summaries)
// ---------------------------------------------------------------------------

function deriveInvestmentComparison(a: ForeverPassport, b: ForeverPassport): DomainComparison {
  return {
    rows: [
      compareRow("entryPrice", "Entry price", a.investment.entryPrice, b.investment.entryPrice),
      compareRow(
        "priceVerification",
        "Price verification",
        a.investment.priceVerificationStatus,
        b.investment.priceVerificationStatus,
      ),
      compareRow(
        "rentalEvidence",
        "Rental income evidence",
        a.investment.rentalEvidence,
        b.investment.rentalEvidence,
      ),
      compareRow(
        "readiness",
        "Investment readiness",
        a.investment.readinessVerdict,
        b.investment.readinessVerdict,
      ),
    ],
  };
}

function deriveRentalComparison(a: ForeverPassport, b: ForeverPassport): DomainComparison {
  return {
    rows: [
      compareRow("demandContext", "Rental demand", a.rental.demandContext, b.rental.demandContext),
      compareRow(
        "incomeEvidence",
        "Rental income evidence",
        a.rental.incomeEvidence,
        b.rental.incomeEvidence,
      ),
      compareRow(
        "guaranteeEvidence",
        "Rental guarantee",
        a.rental.guaranteeEvidence,
        b.rental.guaranteeEvidence,
      ),
      compareRow(
        "readiness",
        "Rental readiness",
        a.rental.readinessVerdict,
        b.rental.readinessVerdict,
      ),
    ],
  };
}

function deriveLocationComparison(a: ForeverPassport, b: ForeverPassport): DomainComparison {
  return {
    rows: [
      compareRow(
        "locationIdentity",
        "Location",
        a.location.locationIdentity,
        b.location.locationIdentity,
      ),
      compareRow(
        "beachProximity",
        "Beach proximity",
        a.location.beachProximity,
        b.location.beachProximity,
      ),
      compareRow(
        "lifestyleEvidence",
        "Lifestyle context",
        a.location.lifestyleEvidence,
        b.location.lifestyleEvidence,
      ),
      compareRow(
        "readiness",
        "Location readiness",
        a.location.readinessVerdict,
        b.location.readinessVerdict,
      ),
    ],
  };
}

function deriveTrustComparison(a: ForeverPassport, b: ForeverPassport): DomainComparison {
  return {
    rows: [
      compareRow(
        "verificationStatus",
        "Verification status",
        a.trust.verificationStatus,
        b.trust.verificationStatus,
      ),
      compareRow("verdict", "Forever verdict", a.trust.verdict, b.trust.verdict),
      compareRow(
        "marketPosition",
        "Market position",
        a.trust.marketPosition,
        b.trust.marketPosition,
      ),
      compareRow(
        "lastInspection",
        "Last inspection",
        a.trust.lastInspection,
        b.trust.lastInspection,
      ),
      compareRow(
        "readiness",
        "Trust readiness",
        a.trust.readinessVerdict,
        b.trust.readinessVerdict,
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// 9. Buyer profile comparison (reuses the Project Summary buyer-profile output)
// ---------------------------------------------------------------------------

function deriveBuyerProfileComparison(
  a: ProjectSummary,
  b: ProjectSummary,
): BuyerProfileComparison {
  return {
    availability: {
      a: a.buyerProfile.available,
      b: b.buyerProfile.available,
    },
    diff: setDiff(a.buyerProfile.statements, b.buyerProfile.statements),
    basis: a.buyerProfile.basis,
  };
}

// ---------------------------------------------------------------------------
// 10. Decision readiness comparison (reuses the Passport readiness verdict only)
// ---------------------------------------------------------------------------

function deriveReadinessComparison(a: ForeverPassport, b: ForeverPassport): ReadinessComparison {
  const verdictA = a.overallVerdict.readinessVerdict;
  const verdictB = b.overallVerdict.readinessVerdict;
  const rankA = readinessRank(verdictA);
  const rankB = readinessRank(verdictB);

  let lead: ComparisonLead;
  if (rankA > rankB) lead = "a";
  else if (rankB > rankA) lead = "b";
  else lead = "equal";

  const note =
    lead === "equal"
      ? `Both projects are currently at the same advisory readiness stage (${verdictA}).`
      : `Project ${lead === "a" ? "A" : "B"} currently has stronger decision readiness: it is ` +
        `further along the shared advisory readiness scale (${lead === "a" ? verdictA : verdictB}) ` +
        `than Project ${lead === "a" ? "B" : "A"} (${lead === "a" ? verdictB : verdictA}). ` +
        `The scale reflects evidence coverage, not project quality.`;

  return {
    a: verdictA,
    b: verdictB,
    rationaleA: a.overallVerdict.rationale,
    rationaleB: b.overallVerdict.rationale,
    lead,
    note,
  };
}

// ---------------------------------------------------------------------------
// 11. Evidence completeness comparison (data coverage only — never quality)
// ---------------------------------------------------------------------------

function deriveEvidenceCompleteness(
  a: ForeverPassport,
  b: ForeverPassport,
): EvidenceCompletenessComparison {
  const order: PassportFoundationKey[] = ["trust", "investment", "rental", "location"];
  const byKeyA = new Map(a.dataCompleteness.byFoundation.map((row) => [row.key, row]));
  const byKeyB = new Map(b.dataCompleteness.byFoundation.map((row) => [row.key, row]));

  const byFoundation: EvidenceCompletenessRow[] = order.map((key) => {
    const rowA = byKeyA.get(key);
    const rowB = byKeyB.get(key);
    const aPresent = rowA?.signalsPresent ?? 0;
    const bPresent = rowB?.signalsPresent ?? 0;
    const total = Math.max(rowA?.signalsTotal ?? 0, rowB?.signalsTotal ?? 0);
    return {
      key,
      label: FOUNDATION_LABEL[key],
      aPresent,
      bPresent,
      total,
      lead: leadByCount(aPresent, bPresent),
    };
  });

  const aPresent = a.dataCompleteness.signalsPresent;
  const bPresent = b.dataCompleteness.signalsPresent;
  const total = Math.max(a.dataCompleteness.signalsTotal, b.dataCompleteness.signalsTotal);
  const overallLead = leadByCount(aPresent, bPresent);

  const note =
    overallLead === "equal"
      ? `Both projects currently carry the same number of verified evidence signals ` +
        `(${aPresent} of ${total}). This reflects data coverage only, not quality.`
      : `Project ${overallLead === "a" ? "A" : "B"} currently has more verified evidence signals ` +
        `on record (${overallLead === "a" ? aPresent : bPresent} of ${total}) than Project ` +
        `${overallLead === "a" ? "B" : "A"} (${overallLead === "a" ? bPresent : aPresent} of ${total}). ` +
        `This reflects data coverage only, not quality.`;

  return {
    byFoundation,
    overall: { aPresent, bPresent, total, lead: overallLead },
    note,
  };
}

// ---------------------------------------------------------------------------
// Descriptive headline (readiness stage, evidence counts, gap counts only)
// ---------------------------------------------------------------------------

function deriveHeadline(
  readiness: ReadinessComparison,
  evidence: EvidenceCompletenessComparison,
  passportA: ForeverPassport,
  passportB: ForeverPassport,
  investment: DomainComparison,
  rental: DomainComparison,
  location: DomainComparison,
  trust: DomainComparison,
): ComparisonHeadline {
  const statements: string[] = [];

  // Readiness stage (documented scale, not a score).
  statements.push(readiness.note);

  // Evidence coverage (data presence, not quality).
  statements.push(evidence.note);

  // Recorded data gaps (fewer unknowns — a coverage statement, not quality).
  const gapsA = passportA.combinedGaps.totalGaps;
  const gapsB = passportB.combinedGaps.totalGaps;
  if (gapsA !== gapsB) {
    const fewer = gapsA < gapsB ? "A" : "B";
    const more = gapsA < gapsB ? "B" : "A";
    statements.push(
      `Project ${fewer} currently has fewer recorded data gaps (${Math.min(gapsA, gapsB)}) than ` +
        `Project ${more} (${Math.max(gapsA, gapsB)}).`,
    );
  } else {
    statements.push(
      `Both projects currently have the same number of recorded data gaps (${gapsA}).`,
    );
  }

  // How many compared evidence fields differ (descriptive difference count).
  const allRows = [...investment.rows, ...rental.rows, ...location.rows, ...trust.rows];
  const differing = allRows.filter((row) => row.status !== "identical").length;
  statements.push(
    `The projects differ on ${differing} of ${allRows.length} compared evidence fields.`,
  );

  return { statements };
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

function deriveMetadata(
  a: ForeverPassport,
  b: ForeverPassport,
  generatedAt: string | undefined,
): ProjectComparisonMetadata {
  return {
    schemaVersion: "1.0",
    comparisonVersion: "1.0",
    source: "advisory-project-comparison",
    projects: [a.identity.projectSlug, b.identity.projectSlug],
    consumes: ["Forever Passport", "Project Summary"],
    generatedAt: hasText(generatedAt) ? generatedAt.trim() : NOT_AVAILABLE,
  };
}

/**
 * Derive the Project Comparison for two projects. Pure and deterministic:
 * identical inputs yield identical output.
 *
 * The comparison CONSUMES the already-derived Forever Passport and Project
 * Summary for each side. When those optional inputs are omitted, the canonical
 * `deriveForeverPassport` / `deriveProjectSummary` derivations are reused so the
 * comparison always reflects the same evidence the rest of the workspace shows.
 * It never recalculates a verdict, never invents a ranking or tie-breaker, and
 * never fabricates a value.
 */
export function deriveProjectComparison(input: DeriveProjectComparisonInput): ProjectComparison {
  const passportA = input.a.passport ?? deriveForeverPassport(input.a.project);
  const passportB = input.b.passport ?? deriveForeverPassport(input.b.project);

  const summaryA =
    input.a.summary ?? deriveProjectSummary({ project: input.a.project, passport: passportA });
  const summaryB =
    input.b.summary ?? deriveProjectSummary({ project: input.b.project, passport: passportB });

  const comparedProjects = deriveComparedProjects(passportA, passportB);
  const passport = derivePassportComparison(passportA, passportB);
  const investment = deriveInvestmentComparison(passportA, passportB);
  const rental = deriveRentalComparison(passportA, passportB);
  const location = deriveLocationComparison(passportA, passportB);
  const trust = deriveTrustComparison(passportA, passportB);
  const strengths = setDiff(summaryA.strengths, summaryB.strengths);
  const considerations = setDiff(summaryA.considerations, summaryB.considerations);
  const buyerProfile = deriveBuyerProfileComparison(summaryA, summaryB);
  const decisionReadiness = deriveReadinessComparison(passportA, passportB);
  const evidenceCompleteness = deriveEvidenceCompleteness(passportA, passportB);
  const headline = deriveHeadline(
    decisionReadiness,
    evidenceCompleteness,
    passportA,
    passportB,
    investment,
    rental,
    location,
    trust,
  );
  const metadata = deriveMetadata(passportA, passportB, input.generatedAt);

  return {
    comparedProjects,
    headline,
    passport,
    investment,
    rental,
    location,
    trust,
    strengths,
    considerations,
    buyerProfile,
    decisionReadiness,
    evidenceCompleteness,
    metadata,
  };
}
