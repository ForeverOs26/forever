import type { ProjectDetail } from "@/features/project-detail/project-detail-types";

import { NOT_AVAILABLE } from "./investment-intelligence";
import {
  deriveForeverPassport,
  type ForeverPassport,
  type PassportReadinessVerdict,
} from "./forever-passport";
import { deriveProjectSummary, type ProjectSummary } from "./project-summary";
import {
  deriveProjectComparison,
  type ComparisonProjectIdentity,
  type ProjectComparison,
} from "./project-comparison";

/**
 * Project Recommendations — the recommendation layer for Forever Advisor (RC2.7).
 *
 * This is NOT a new intelligence foundation and NOT a new scoring engine. It is a
 * thin, descriptive recommendation layer built strictly on top of the
 * already-derived outputs of the earlier sprints:
 *
 *   Project 1 ─┐
 *   Project 2 ─┼─→ deriveForeverPassport() → deriveProjectSummary()
 *      …       ┘            ↓ (top two)
 *                    deriveProjectComparison()
 *                           ↓
 *              deriveProjectRecommendations()  ← this layer (pure, deterministic)
 *                           ↓
 *                    Advisory Workspace
 *
 * Hard rules honoured here (locked down by the module tests):
 *  - It introduces NO new scoring engine and calculates NO new rating, match
 *    score, ROI, yield, appreciation, occupancy, or buyer-fit value. It never
 *    converts a qualitative verdict into a number and never surfaces the hidden
 *    numeric `trust.trustScore`.
 *  - Every recommended value is REUSED verbatim from the already-derived Forever
 *    Passport, Project Summary and (for the top two) Project Comparison. No
 *    derivation logic is duplicated and no raw ProjectDetail metric is
 *    recalculated here.
 *  - The recommendation ORDER is descriptive, never a hidden-value ranking. It is
 *    a deterministic sort over three already-derived, evidence-only measures: the
 *    documented advisory readiness stage, the count of present verified evidence
 *    signals (data presence, never quality), and the count of recorded data gaps.
 *    Ties break on slug then name so identical input always yields identical
 *    output. Every rationale states that the order reflects data coverage and
 *    documented readiness only — never project quality or buyer suitability.
 *  - Anything not supported by verified data renders as the shared
 *    `NOT_AVAILABLE` sentinel. Nothing is fabricated or invented.
 *  - Identical input always produces identical output (pure function). The only
 *    non-deterministic value — the generation timestamp — is never computed
 *    internally; it is surfaced only when the caller supplies it.
 */

/** Evidence-coverage counts for one candidate, reused from the Passport. */
export interface RecommendationCoverage {
  /** Verified evidence signals present across the four foundations. */
  signalsPresent: number;
  signalsTotal: number;
  /** Recorded key data gaps across the four foundations. */
  recordedGaps: number;
  /** Foundations at the "Ready for preliminary review" stage. */
  foundationsReady: number;
  foundationsTotal: number;
}

/**
 * Suitability notes for one candidate. Reused verbatim from the Project Summary
 * buyer profile — never a fabricated demographic persona.
 */
export interface RecommendationSuitability {
  available: boolean;
  statements: string[];
  basis: string;
}

/** One ranked candidate in the recommendation list. */
export interface ProjectRecommendationEntry {
  /**
   * Ordinal position in the evidence-coverage ranking (1-based). This is a
   * POSITION, not a score: it is never divided by a total, never a percentage,
   * and never implies a quality judgement.
   */
  rank: number;
  /** Reused verbatim from the Passport identity. */
  identity: ComparisonProjectIdentity;
  /** The Passport overall readiness verdict, reused verbatim. Never recomputed. */
  readinessVerdict: PassportReadinessVerdict;
  /** The Passport overall readiness rationale, reused verbatim. */
  readinessRationale: string;
  coverage: RecommendationCoverage;
  /** Reused verbatim from the Project Summary strengths. */
  strengths: string[];
  /** Reused verbatim from the Project Summary considerations. */
  considerations: string[];
  suitability: RecommendationSuitability;
  /**
   * Controlled, evidence-only explanation of the ranking position. Grounded only
   * in the documented readiness stage and the present-evidence / recorded-gap
   * counts. Always states that the order reflects data coverage, not quality.
   */
  rationale: string;
}

/** The candidate ranked first on evidence coverage, or `null` when none exists. */
export interface RecommendationTop {
  projectSlug: string;
  projectName: string;
  /** Always `1` — the first position on the evidence-coverage ranking. */
  rank: number;
  /** Controlled, evidence-only note describing the leading candidate. */
  note: string;
}

/** A high-level descriptive read of the recommendation set. */
export interface ProjectRecommendationsHeadline {
  statements: string[];
}

/** Provenance metadata — never fabricated. */
export interface ProjectRecommendationsMetadata {
  schemaVersion: "1.0";
  recommendationsVersion: "1.0";
  /** Names the recommendation source — the Passport + Summary + Comparison layers. */
  source: "advisory-project-recommendations";
  /** The ranked project slugs, in recommendation order. */
  projects: string[];
  candidateCount: number;
  /** The already-derived outputs this layer consumes. */
  consumes: string[];
  /**
   * Generation timestamp. Never computed inside the pure derivation; it is the
   * caller-supplied value, or `NOT_AVAILABLE` when none is supplied.
   */
  generatedAt: string;
}

/** The complete, presentational-ready Project Recommendations view model. */
export interface ProjectRecommendations {
  /** Ranked entries, best evidence coverage first. Empty when no candidates. */
  entries: ProjectRecommendationEntry[];
  /** The rank-1 candidate, or `null` when there are no candidates. */
  topRecommendation: RecommendationTop | null;
  headline: ProjectRecommendationsHeadline;
  /**
   * Optional head-to-head comparison of the top two candidates, reusing the
   * RC2.6 Project Comparison output verbatim. `null` when fewer than two
   * candidates are available.
   */
  comparison: ProjectComparison | null;
  /** Controlled explanation of how the order is derived (evidence-only). */
  basis: string;
  metadata: ProjectRecommendationsMetadata;
}

/**
 * One candidate for the recommendation. The Passport and Summary are OPTIONAL:
 * when omitted the canonical `deriveForeverPassport` / `deriveProjectSummary`
 * derivations are reused (never re-implemented), so the recommendation always
 * consumes the same derived output the rest of the Advisory Workspace uses.
 */
export interface RecommendationCandidateInput {
  project: ProjectDetail;
  /** Already-derived Forever Passport. Reused via `deriveForeverPassport` when omitted. */
  passport?: ForeverPassport;
  /** Already-derived Project Summary. Reused via `deriveProjectSummary` when omitted. */
  summary?: ProjectSummary;
}

/** Inputs for the derivation. Kept as an options object per the RC2.7 spec. */
export interface DeriveProjectRecommendationsInput {
  candidates: RecommendationCandidateInput[];
  /** Caller-supplied generation timestamp. Surfaced verbatim in metadata. */
  generatedAt?: string;
}

/**
 * The documented, public advisory readiness scale, ordered low → high. This
 * mirrors the Passport's own documented scale exactly; it is NOT a new score. It
 * is used only to order candidates by how far along that stated scale they are.
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

/** Singular / plural helper for controlled count phrases ("1 gap", "2 gaps"). */
function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

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

/**
 * Internal, fully-derived candidate used for ranking. Every measure it carries
 * is REUSED from the already-derived Passport / Summary — nothing is recomputed.
 */
interface PreparedCandidate {
  project: ProjectDetail;
  passport: ForeverPassport;
  summary: ProjectSummary;
  identity: ComparisonProjectIdentity;
  readinessVerdict: PassportReadinessVerdict;
  signalsPresent: number;
  signalsTotal: number;
  recordedGaps: number;
  slugLower: string;
  nameLower: string;
}

function prepare(candidate: RecommendationCandidateInput): PreparedCandidate {
  const passport = candidate.passport ?? deriveForeverPassport(candidate.project);
  const summary =
    candidate.summary ?? deriveProjectSummary({ project: candidate.project, passport });
  const identity = toIdentity(passport);
  return {
    project: candidate.project,
    passport,
    summary,
    identity,
    readinessVerdict: passport.overallVerdict.readinessVerdict,
    signalsPresent: passport.dataCompleteness.signalsPresent,
    signalsTotal: passport.dataCompleteness.signalsTotal,
    recordedGaps: passport.combinedGaps.totalGaps,
    slugLower: identity.projectSlug.toLowerCase(),
    nameLower: identity.projectName.toLowerCase(),
  };
}

/**
 * Deterministic, evidence-only ordering. Higher readiness stage first, then more
 * present evidence signals, then fewer recorded gaps, then a stable slug/name
 * tie-break. This is a descriptive sort over already-derived measures — NOT a new
 * score and NOT a quality judgement.
 */
function compareCandidates(a: PreparedCandidate, b: PreparedCandidate): number {
  const byReadiness = readinessRank(b.readinessVerdict) - readinessRank(a.readinessVerdict);
  if (byReadiness !== 0) return byReadiness;

  const bySignals = b.signalsPresent - a.signalsPresent;
  if (bySignals !== 0) return bySignals;

  const byGaps = a.recordedGaps - b.recordedGaps;
  if (byGaps !== 0) return byGaps;

  const bySlug = a.slugLower.localeCompare(b.slugLower);
  if (bySlug !== 0) return bySlug;

  return a.nameLower.localeCompare(b.nameLower);
}

const COVERAGE_DISCLAIMER =
  "This reflects data coverage and documented readiness stage, not project quality or suitability for any particular buyer.";

function entryRationale(prepared: PreparedCandidate, rank: number): string {
  return (
    `Ranked ${rank} on evidence coverage: ${prepared.readinessVerdict}; ` +
    `${prepared.signalsPresent} of ${prepared.signalsTotal} verified evidence signals present; ` +
    `${plural(prepared.recordedGaps, "recorded data gap")}. ${COVERAGE_DISCLAIMER}`
  );
}

function toEntry(prepared: PreparedCandidate, rank: number): ProjectRecommendationEntry {
  const { passport, summary } = prepared;
  return {
    rank,
    identity: prepared.identity,
    readinessVerdict: prepared.readinessVerdict,
    readinessRationale: passport.overallVerdict.rationale,
    coverage: {
      signalsPresent: prepared.signalsPresent,
      signalsTotal: prepared.signalsTotal,
      recordedGaps: prepared.recordedGaps,
      foundationsReady: passport.evidenceCoverage.foundationsReady,
      foundationsTotal: passport.evidenceCoverage.foundationsTotal,
    },
    strengths: summary.strengths,
    considerations: summary.considerations,
    suitability: {
      available: summary.buyerProfile.available,
      statements: summary.buyerProfile.statements,
      basis: summary.buyerProfile.basis,
    },
    rationale: entryRationale(prepared, rank),
  };
}

function deriveTop(entries: ProjectRecommendationEntry[]): RecommendationTop | null {
  const first = entries[0];
  if (!first) return null;

  const name = hasText(first.identity.projectName) ? first.identity.projectName : "This project";
  const note =
    `${name} is ranked first on evidence coverage among ` +
    `${plural(entries.length, "candidate project")}: ${first.readinessVerdict}; ` +
    `${first.coverage.signalsPresent} of ${first.coverage.signalsTotal} verified evidence signals present; ` +
    `${plural(first.coverage.recordedGaps, "recorded data gap")}. ${COVERAGE_DISCLAIMER}`;

  return {
    projectSlug: first.identity.projectSlug,
    projectName: first.identity.projectName,
    rank: first.rank,
    note,
  };
}

function deriveHeadline(entries: ProjectRecommendationEntry[]): ProjectRecommendationsHeadline {
  if (entries.length === 0) {
    return { statements: ["No projects are available to recommend."] };
  }

  const statements: string[] = [
    `Ranked ${plural(entries.length, "project")} by already-verified evidence coverage and documented advisory readiness only.`,
  ];

  const first = entries[0];
  const firstName = hasText(first.identity.projectName)
    ? first.identity.projectName
    : "The first project";
  statements.push(
    `${firstName} is ranked first: ${first.readinessVerdict}, ` +
      `${first.coverage.signalsPresent} of ${first.coverage.signalsTotal} verified evidence signals present, ` +
      `${plural(first.coverage.recordedGaps, "recorded data gap")}.`,
  );

  if (entries.length > 1) {
    const last = entries[entries.length - 1];
    const lastName = hasText(last.identity.projectName)
      ? last.identity.projectName
      : "the last project";
    statements.push(
      `The ranking spans from ${first.coverage.signalsPresent} to ${last.coverage.signalsPresent} ` +
        `verified evidence signals present (${firstName} down to ${lastName}).`,
    );
  }

  statements.push(COVERAGE_DISCLAIMER);
  return { statements };
}

const BASIS =
  "Recommendations are ordered using only already-derived outputs — the Forever " +
  "Passport overall readiness verdict, the count of present verified evidence " +
  "signals, and the count of recorded data gaps. No new score, rating, ranking " +
  "metric, or buyer-match value is calculated, and no verified figure is " +
  "recomputed. The order reflects data coverage and documented readiness stage " +
  "only, never project quality or suitability for any particular buyer.";

function deriveMetadata(
  ranked: PreparedCandidate[],
  generatedAt: string | undefined,
): ProjectRecommendationsMetadata {
  return {
    schemaVersion: "1.0",
    recommendationsVersion: "1.0",
    source: "advisory-project-recommendations",
    projects: ranked.map((candidate) => candidate.identity.projectSlug),
    candidateCount: ranked.length,
    consumes: ["Forever Passport", "Project Summary", "Project Comparison"],
    generatedAt: hasText(generatedAt) ? generatedAt.trim() : NOT_AVAILABLE,
  };
}

/**
 * Derive the Project Recommendations for a set of candidate projects. Pure and
 * deterministic: identical inputs yield identical output.
 *
 * The recommendation CONSUMES the already-derived Forever Passport and Project
 * Summary for each candidate (and, for the top two, the Project Comparison). When
 * those optional inputs are omitted, the canonical `deriveForeverPassport` /
 * `deriveProjectSummary` / `deriveProjectComparison` derivations are reused so the
 * recommendation always reflects the same evidence the rest of the workspace
 * shows. It never recalculates a verdict, never invents a match score or ranking
 * value, and never fabricates a value.
 */
export function deriveProjectRecommendations(
  input: DeriveProjectRecommendationsInput,
): ProjectRecommendations {
  const prepared = input.candidates.map(prepare);

  // Deterministic evidence-coverage ordering (does not mutate the input array).
  const ranked = [...prepared].sort(compareCandidates);

  const entries = ranked.map((candidate, index) => toEntry(candidate, index + 1));
  const topRecommendation = deriveTop(entries);
  const headline = deriveHeadline(entries);

  // Reuse the RC2.6 comparison for the top two candidates — never re-implemented.
  const comparison =
    ranked.length >= 2
      ? deriveProjectComparison({
          a: {
            project: ranked[0].project,
            passport: ranked[0].passport,
            summary: ranked[0].summary,
          },
          b: {
            project: ranked[1].project,
            passport: ranked[1].passport,
            summary: ranked[1].summary,
          },
        })
      : null;

  const metadata = deriveMetadata(ranked, input.generatedAt);

  return {
    entries,
    topRecommendation,
    headline,
    comparison,
    basis: BASIS,
    metadata,
  };
}
