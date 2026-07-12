/**
 * Forever Cross-Source Validation — the per-subject assessment.
 *
 * A {@link CrossValidationAssessment} is what the examination concluded about
 * one subject: every reading recorded for it (current and outdated alike —
 * described, never dropped), the {@link CrossValidationConsensus} its current
 * readings reach, and the findings that concern it. The consensus vocabulary
 * is deliberately built to *preserve* uncertainty: `contested` keeps every
 * side of a disagreement standing, `incomparable` says agreement cannot even
 * be judged (different units, currencies, or languages — RC4.7 never
 * normalizes its way to a comparison), `uncorroborated` says only one
 * source — or only mutually dependent sources — speak, and `unaddressed`
 * says nothing speaks at all. Nothing here elects a winner.
 *
 * {@link judgeCrossValidationConsensus} is the pure judgement rule, applied
 * over the current readings only (outdated and superseded readings are
 * described by their own findings): signatures are the reused RC4.6
 * byte-level rule carried on each reading, and independence is the RC4.4
 * relationship judgement — agreement between two revisions of the same
 * document, or between a document and its own translation, corroborates
 * nothing.
 */

import type { ProjectSourceDefinition } from "@/features/forever-project-sources";

import { areIndependentCrossSources } from "./authority";
import type { CrossValidationDimension } from "./finding";
import type { CrossSourceReading } from "./reading";
import type { CrossValidationSubject } from "./subject";

/** What the current readings of one subject amount to — never a resolution. */
export type CrossValidationConsensus =
  | "corroborated"
  | "uncorroborated"
  | "contested"
  | "incomparable"
  | "unaddressed";

/** Every {@link CrossValidationConsensus}, in a stable declared order. */
export const CROSS_VALIDATION_CONSENSUSES = [
  "corroborated",
  "uncorroborated",
  "contested",
  "incomparable",
  "unaddressed",
] as const satisfies readonly CrossValidationConsensus[];

/** Runtime guard: whether a value is a known {@link CrossValidationConsensus}. */
export function isKnownCrossValidationConsensus(value: unknown): value is CrossValidationConsensus {
  return (
    typeof value === "string" && (CROSS_VALIDATION_CONSENSUSES as readonly string[]).includes(value)
  );
}

/** What the examination concluded about one subject. */
export interface CrossValidationAssessment {
  subject: CrossValidationSubject;
  /**
   * Every reading recorded for the subject — current and outdated alike, in
   * the module's deterministic reading order. Described, never dropped.
   */
  readings: CrossSourceReading[];
  /** What the current readings amount to. Preserved uncertainty, no winner. */
  consensus: CrossValidationConsensus;
  /** The findings that concern this subject, in the report's finding order. */
  findingIds: string[];
}

/** Every current, value-carrying reading, in input order. */
export function listCurrentCrossSourceReadings(
  readings: readonly CrossSourceReading[],
): CrossSourceReading[] {
  return (Array.isArray(readings) ? readings : []).filter((reading) => reading?.current === true);
}

/** The distinct source ids across readings, in first-seen order. */
export function distinctCrossReadingSources(readings: readonly CrossSourceReading[]): string[] {
  const seen = new Set<string>();
  for (const reading of Array.isArray(readings) ? readings : []) {
    if (typeof reading?.sourceId === "string" && reading.sourceId !== "") {
      seen.add(reading.sourceId);
    }
  }
  return [...seen];
}

/** The distinct value signatures across readings, in first-seen order. */
export function distinctCrossReadingSignatures(readings: readonly CrossSourceReading[]): string[] {
  const seen = new Set<string>();
  for (const reading of Array.isArray(readings) ? readings : []) {
    if (typeof reading?.signature === "string") seen.add(reading.signature);
  }
  return [...seen];
}

function distinctDefined(values: readonly (string | undefined)[]): {
  defined: Set<string>;
  hasUndefined: boolean;
} {
  const defined = new Set<string>();
  let hasUndefined = false;
  for (const value of values) {
    if (value === undefined) hasUndefined = true;
    else defined.add(value);
  }
  return { defined, hasUndefined };
}

/** The verdict of {@link judgeCrossValidationConsensus}. */
export interface CrossValidationConsensusVerdict {
  consensus: CrossValidationConsensus;
  /** The aspect that made the readings incomparable, when they are. */
  dimension?: CrossValidationDimension;
}

/**
 * Judge what a subject's readings amount to. Pure, total, and deterministic —
 * and deliberately unable to resolve anything.
 *
 * Judged over the *current* readings only, with the comparability dimensions
 * judged over the current *value-carrying* readings (a stated absence
 * declares no unit, currency, or language — it participates by its signature
 * alone). In order:
 *
 * - no current reading → `unaddressed`;
 * - units not uniform (two declared units differ, or a declared unit meets an
 *   undeclared one — a quantity of unknown dimension cannot be compared) →
 *   `incomparable` over the `unit` dimension;
 * - currencies not uniform (same strictness — monetary readings only state a
 *   currency through the reused RC3.0 `Money` shape) → `incomparable` over
 *   the `currency` dimension;
 * - two or more *declared* languages differ while the signatures differ —
 *   the difference may be translation rather than contradiction, and RC4.7
 *   never translates — → `incomparable` over the `language` dimension;
 * - more than one distinct signature → `contested`: a real disagreement,
 *   every side kept standing;
 * - one signature stated by at least two *independent* sources (the reused
 *   RC4.4 relationship judgement) → `corroborated`;
 * - otherwise → `uncorroborated`: one source, or only mutually dependent
 *   sources, stand behind the reading.
 */
export function judgeCrossValidationConsensus(
  readings: readonly CrossSourceReading[],
  sources?: readonly ProjectSourceDefinition[],
): CrossValidationConsensusVerdict {
  const current = listCurrentCrossSourceReadings(readings);
  if (current.length === 0) return { consensus: "unaddressed" };

  // Comparability dimensions are judged over the value-carrying readings
  // only: a stated absence declares no unit, currency, or language, and it
  // disagrees (or agrees) with other readings by its signature alone.
  const valued = current.filter((reading) => reading?.statesAbsence !== true);
  const units = distinctDefined(valued.map((reading) => reading.unit));
  if (units.defined.size > 1 || (units.defined.size === 1 && units.hasUndefined)) {
    return { consensus: "incomparable", dimension: "unit" };
  }
  const currencies = distinctDefined(valued.map((reading) => reading.currency));
  if (currencies.defined.size > 1 || (currencies.defined.size === 1 && currencies.hasUndefined)) {
    return { consensus: "incomparable", dimension: "currency" };
  }

  const signatures = distinctCrossReadingSignatures(current);
  const languages = distinctDefined(valued.map((reading) => reading.language));
  if (languages.defined.size > 1 && signatures.length > 1) {
    return { consensus: "incomparable", dimension: "language" };
  }

  if (signatures.length > 1) return { consensus: "contested" };

  const sourceIds = distinctCrossReadingSources(current);
  for (let i = 0; i < sourceIds.length; i += 1) {
    for (let j = i + 1; j < sourceIds.length; j += 1) {
      if (areIndependentCrossSources(sourceIds[i], sourceIds[j], sources)) {
        return { consensus: "corroborated" };
      }
    }
  }
  return { consensus: "uncorroborated" };
}
