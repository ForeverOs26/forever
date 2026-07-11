/**
 * Forever Advisory — Advisor Report derivation (RC2.8).
 *
 * A pure, deterministic COMPOSITION layer. It assembles the already-derived
 * Forever Advisory outputs — Forever Passport (RC2.4), Project Summary (RC2.5),
 * the Investment / Rental / Location Intelligence foundations (RC2.1–RC2.3) and,
 * when available, Project Comparison (RC2.6) and Project Recommendations (RC2.7)
 * — into one coherent, client-facing, print-ready advisory report.
 *
 * This module is a PRESENTATION AND COMPOSITION layer only. It:
 *  - never introduces a new score, verdict, ranking or persona;
 *  - never recalculates ROI, yield, occupancy, distances or any other metric;
 *  - never exposes the hidden numeric `trustScore`;
 *  - never fabricates a project fact — anything not on record renders as the
 *    shared `NOT_AVAILABLE` sentinel;
 *  - reuses every conclusion verbatim from the derived output it consumes.
 *
 * Determinism: identical input always yields identical output. The only
 * non-deterministic value — the report date — is never computed internally; it
 * is surfaced only when the caller supplies `generatedAt`.
 */

import type { ProjectDetail } from "@/features/project-detail/project-detail-types";

import { NOT_AVAILABLE } from "./investment-intelligence";
import type { InvestmentIntelligence } from "./investment-intelligence";
import type { RentalIntelligence } from "./rental-intelligence";
import type { LocationIntelligence } from "./location-intelligence";
import type {
  ForeverPassport,
  PassportProjectIdentity,
  PassportReadinessVerdict,
  PassportTrustSummary,
} from "./forever-passport";
import type {
  ProjectSummary,
  ProjectSummaryBuyerProfile,
  ProjectSummaryFact,
  ProjectSummarySignal,
} from "./project-summary";
import type { ProjectComparison } from "./project-comparison";
import type { ProjectRecommendations } from "./project-recommendations";

/** Fixed brand + title strings. Controlled — never promotional, never dynamic. */
const REPORT_BRAND = "Forever" as const;
const REPORT_TITLE = "Forever Advisor Report" as const;

/**
 * Stable identifiers for every report section, in the exact order the report
 * presents them. Optional sections (`comparison`, `recommendations`) appear in
 * this list only when their data is available, so the array itself is the
 * single source of truth for section ordering.
 */
export type AdvisorReportSectionKey =
  | "cover"
  | "executive-overview"
  | "identity"
  | "strengths"
  | "considerations"
  | "buyer-profile"
  | "investment"
  | "rental"
  | "location"
  | "trust"
  | "comparison"
  | "recommendations"
  | "data-limitations"
  | "disclaimer";

/** 1. Report cover — Forever branding and the evidence-only disclaimer. */
export interface AdvisorReportCover {
  brand: typeof REPORT_BRAND;
  reportTitle: typeof REPORT_TITLE;
  /** Primary project name, reused verbatim from the Passport identity. */
  projectName: string;
  /**
   * The report date. Present ONLY when the caller supplies `generatedAt`; the
   * field is entirely absent otherwise, so a report never implies a date it was
   * not given.
   */
  reportDate?: string;
  /** Controlled evidence-only disclaimer. Never promotional. */
  disclaimer: string;
}

/**
 * 2. Executive decision overview — reuses the Passport readiness verdict and the
 * Project Summary overview verbatim. No new verdict is produced here.
 */
export interface AdvisorReportExecutiveOverview {
  /** The Passport overall readiness verdict, reused verbatim. */
  readinessVerdict: PassportReadinessVerdict;
  /** The Passport overall readiness rationale, reused verbatim. */
  readinessRationale: string;
  /** The Project Summary overview headline, reused verbatim. */
  overviewHeadline: string;
  /** The Project Summary readiness statement, reused verbatim. */
  readinessStatement: string;
  /** The Project Summary domain signals, reused verbatim. */
  signals: ProjectSummarySignal[];
}

/**
 * 3. Project identity and verified facts — reuses the Passport identity and the
 * Project Summary key facts. Surfaces only verified values.
 */
export interface AdvisorReportIdentity {
  /** The Passport project identity, reused verbatim. */
  identity: PassportProjectIdentity;
  /** The Project Summary key facts (present-only), reused verbatim. */
  keyFacts: ProjectSummaryFact[];
}

/** 14. Advisory disclaimer — controlled, restrained statements. */
export interface AdvisorReportDisclaimer {
  statements: string[];
}

/** Provenance metadata — never fabricated. */
export interface AdvisorReportMetadata {
  schemaVersion: "1.0";
  reportVersion: "1.0";
  /** Names the composition source — the Advisory derived outputs. */
  source: "advisory-advisor-report";
  projectSlug: string;
  projectName: string;
  /** The Passport overall readiness verdict, mirrored for at-a-glance context. */
  readinessVerdict: PassportReadinessVerdict;
  /** The already-derived outputs this report composes, in architectural order. */
  consumes: string[];
  /**
   * Generation timestamp. Never computed inside the pure derivation; present
   * ONLY when the caller supplies `generatedAt`, and entirely absent otherwise.
   */
  generatedAt?: string;
}

/**
 * The complete, presentational-ready Advisor Report for one project. Every
 * substantive field is reused verbatim from an already-derived Advisory output.
 */
export interface AdvisorReport {
  /** The ordered list of sections present in this report. */
  sections: AdvisorReportSectionKey[];
  cover: AdvisorReportCover;
  executiveOverview: AdvisorReportExecutiveOverview;
  identity: AdvisorReportIdentity;
  /** Principal strengths — reused verbatim from the Project Summary. */
  strengths: string[];
  /** Principal considerations — reused verbatim from the Project Summary. */
  considerations: string[];
  /** Suitable buyer profile — reused verbatim from the Project Summary. */
  buyerProfile: ProjectSummaryBuyerProfile;
  /** Investment Intelligence — reused verbatim from the derived foundation. */
  investment: InvestmentIntelligence;
  /** Rental Intelligence — reused verbatim from the derived foundation. */
  rental: RentalIntelligence;
  /** Location Intelligence — reused verbatim from the derived foundation. */
  location: LocationIntelligence;
  /**
   * Trust and evidence readiness — reused verbatim from the Passport Trust
   * summary. This shape deliberately carries no numeric `trustScore`.
   */
  trust: PassportTrustSummary;
  /**
   * Project Comparison — present ONLY when a comparison is supplied. Reused
   * verbatim from the RC2.6 output; nothing is recomputed here.
   */
  comparison?: ProjectComparison;
  /**
   * Project Recommendations — present ONLY when recommendations are supplied.
   * Reused verbatim from the RC2.7 output, preserving its ordering.
   */
  recommendations?: ProjectRecommendations;
  /** Data limitations — the deduplicated union of Passport + Summary gaps. */
  dataLimitations: string[];
  /** Advisory disclaimer — controlled, restrained. */
  disclaimer: AdvisorReportDisclaimer;
  metadata: AdvisorReportMetadata;
}

/**
 * Inputs for the derivation. The Passport, Summary and the three Intelligence
 * foundations are REQUIRED — they are the already-derived outputs the report
 * composes. Comparison and Recommendations are optional and drive the two
 * optional sections. Kept as an options object per the RC2.8 spec.
 */
export interface DeriveAdvisorReportInput {
  project: ProjectDetail;
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
   * Caller-supplied generation timestamp. Surfaced verbatim as the report date
   * and in metadata. When omitted, no date appears anywhere in the report.
   */
  generatedAt?: string;
}

/** Controlled evidence-only cover disclaimer. Restrained, never promotional. */
const COVER_DISCLAIMER =
  "This report presents only verified project evidence and previously derived Forever " +
  'Advisory outputs. Values that are not on record are shown as "Not available". No ' +
  "figures have been estimated and no new scores, verdicts or rankings have been produced.";

/** Controlled advisory disclaimer statements. Restrained liability language. */
const DISCLAIMER_STATEMENTS: string[] = [
  "Evidence availability may change as project information is updated or newly verified.",
  "This report does not replace independent legal, tax, financial, structural or other professional due diligence.",
  "All statements are drawn only from recorded project evidence and previously derived Forever Advisory outputs.",
];

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Deduplicate a list of strings case-insensitively, preserving first-seen order
 * and dropping empties. Used to merge the Passport and Summary gap lists without
 * inventing any new gap.
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
 * Derive the print-ready Advisor Report by composing already-derived Advisory
 * outputs. Pure and deterministic: no timestamps, no randomness, no I/O.
 */
export function deriveAdvisorReport(input: DeriveAdvisorReportInput): AdvisorReport {
  const {
    project,
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
  const projectSlug = hasText(project.core.slug) ? project.core.slug.trim() : NOT_AVAILABLE;
  const hasGeneratedAt = hasText(generatedAt);

  // --- 1. Cover -----------------------------------------------------------
  const cover: AdvisorReportCover = {
    brand: REPORT_BRAND,
    reportTitle: REPORT_TITLE,
    projectName,
    disclaimer: COVER_DISCLAIMER,
    // reportDate is added ONLY when a timestamp is supplied (see below).
  };
  if (hasGeneratedAt) {
    cover.reportDate = generatedAt.trim();
  }

  // --- 2. Executive decision overview (reused verbatim) -------------------
  const executiveOverview: AdvisorReportExecutiveOverview = {
    readinessVerdict: passport.overallVerdict.readinessVerdict,
    readinessRationale: passport.overallVerdict.rationale,
    overviewHeadline: summary.overview.headline,
    readinessStatement: summary.overview.readinessStatement,
    signals: summary.overview.signals,
  };

  // --- 3. Identity + verified facts (reused verbatim) ---------------------
  const identity: AdvisorReportIdentity = {
    identity: passport.identity,
    keyFacts: summary.keyFacts,
  };

  // --- 13. Data limitations (dedupe Passport + Summary gaps) --------------
  const dataLimitations = dedupe([...passport.combinedGaps.combined, ...summary.dataLimitations]);

  // --- Section ordering ---------------------------------------------------
  const sections: AdvisorReportSectionKey[] = [
    "cover",
    "executive-overview",
    "identity",
    "strengths",
    "considerations",
    "buyer-profile",
    "investment",
    "rental",
    "location",
    "trust",
  ];
  if (comparison) sections.push("comparison");
  if (recommendations) sections.push("recommendations");
  sections.push("data-limitations", "disclaimer");

  // --- Metadata (provenance only) -----------------------------------------
  const consumes = [
    "forever-passport",
    "project-summary",
    "investment-intelligence",
    "rental-intelligence",
    "location-intelligence",
  ];
  if (comparison) consumes.push("project-comparison");
  if (recommendations) consumes.push("project-recommendations");

  const metadata: AdvisorReportMetadata = {
    schemaVersion: "1.0",
    reportVersion: "1.0",
    source: "advisory-advisor-report",
    projectSlug,
    projectName,
    readinessVerdict: passport.overallVerdict.readinessVerdict,
    consumes,
    // generatedAt is added ONLY when supplied (see below).
  };
  if (hasGeneratedAt) {
    metadata.generatedAt = generatedAt.trim();
  }

  const report: AdvisorReport = {
    sections,
    cover,
    executiveOverview,
    identity,
    strengths: summary.strengths,
    considerations: summary.considerations,
    buyerProfile: summary.buyerProfile,
    investment,
    rental,
    location,
    trust: passport.trust,
    dataLimitations,
    disclaimer: { statements: DISCLAIMER_STATEMENTS },
    metadata,
  };

  // Optional sections are added ONLY when their data is available, so the
  // corresponding keys stay entirely absent otherwise.
  if (comparison) report.comparison = comparison;
  if (recommendations) report.recommendations = recommendations;

  return report;
}
