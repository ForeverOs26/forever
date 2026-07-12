/**
 * Coralina advisory consumption — reuse the existing derivations, unchanged.
 *
 * Feeds the canonical Coralina project (as a `ProjectDetail`) into the existing
 * Advisory architecture and returns its outputs. Nothing here re-implements or
 * duplicates a derivation: it imports the real RC2.1–RC2.9 functions and calls
 * them in their documented order.
 *
 * Because Coralina lacks a verified developer, construction status, currency,
 * and any rental/investment evidence, the reused derivations return their own
 * conservative "Insufficient verified data" verdicts and "Not available" fields —
 * this module adds no scores or verdicts of its own, it only wires the input.
 */

import { deriveAdvisorReport, type AdvisorReport } from "@/features/advisory/advisor-report";
import { deriveClientStrategy, type ClientStrategy } from "@/features/advisory/client-strategy";
import { deriveForeverPassport, type ForeverPassport } from "@/features/advisory/forever-passport";
import {
  deriveInvestmentIntelligence,
  type InvestmentIntelligence,
} from "@/features/advisory/investment-intelligence";
import {
  deriveLocationIntelligence,
  type LocationIntelligence,
} from "@/features/advisory/location-intelligence";
import { deriveProjectSummary, type ProjectSummary } from "@/features/advisory/project-summary";
import {
  deriveRentalIntelligence,
  type RentalIntelligence,
} from "@/features/advisory/rental-intelligence";
import type { ProjectDetail } from "@/features/project-detail/project-detail-types";

import { buildCoralinaProjectDetail } from "../adapters/coralina-project-detail";

/** The advisory outputs derived for Coralina, all from the existing derivations. */
export interface CoralinaAdvisory {
  project: ProjectDetail;
  investment: InvestmentIntelligence;
  rental: RentalIntelligence;
  location: LocationIntelligence;
  passport: ForeverPassport;
  summary: ProjectSummary;
  report: AdvisorReport;
  strategy: ClientStrategy;
}

/** Options for {@link deriveCoralinaAdvisory}. */
export interface DeriveCoralinaAdvisoryOptions {
  /** Deterministic timestamp threaded to every derivation; omitted → pure. */
  generatedAt?: string;
  /** Override the ProjectDetail (defaults to the canonical Coralina project). */
  project?: ProjectDetail;
}

/**
 * Derive the full advisory bundle for Coralina by reusing the existing
 * derivations in dependency order. Pure and deterministic.
 */
export function deriveCoralinaAdvisory(
  options: DeriveCoralinaAdvisoryOptions = {},
): CoralinaAdvisory {
  const project = options.project ?? buildCoralinaProjectDetail();
  const generatedAt = options.generatedAt;

  const investment = deriveInvestmentIntelligence(project);
  const rental = deriveRentalIntelligence(project);
  const location = deriveLocationIntelligence(project);
  const passport = deriveForeverPassport(project, generatedAt ? { generatedAt } : {});
  const summary = deriveProjectSummary({
    project,
    passport,
    investment,
    rental,
    location,
    ...(generatedAt ? { generatedAt } : {}),
  });
  const report = deriveAdvisorReport({
    project,
    passport,
    summary,
    investment,
    rental,
    location,
    ...(generatedAt ? { generatedAt } : {}),
  });
  const strategy = deriveClientStrategy({
    passport,
    summary,
    investment,
    rental,
    location,
    ...(generatedAt ? { generatedAt } : {}),
  });

  return { project, investment, rental, location, passport, summary, report, strategy };
}
