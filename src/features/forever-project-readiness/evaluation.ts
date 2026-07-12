/**
 * Forever Project Readiness — the evaluation.
 *
 * A {@link ReadinessEvaluation} is what the examination concluded about one
 * admissible stated requirement: the normalized statement itself (the
 * caller's demand, preserved — with only the effective necessity made
 * explicit), the {@link ReadinessVerdict} the supplied inputs support, the
 * reason in plain words, the {@link ReadinessReference}s that trace the
 * judgement back to the canonical paths, RC4.5 facts, and RC4.4 sources it
 * read, the RC4.7 finding ids involved when the examination report grounded
 * the judgement, and the RC4.8 subject standing observed when one was. An
 * evaluation *describes* — it waives nothing, enforces nothing, and never
 * implies more certainty than the inputs carry: absent inputs settle into an
 * explicit `indeterminate`, never into a fabricated judgement.
 *
 * The reference shape is the RC4.7
 * {@link import("@/features/forever-cross-validation").CrossValidationReference},
 * reused verbatim — a readiness judgement points at facts, sources, pinned
 * revisions, and canonical paths through exactly the reference the
 * cross-source examination uses, never a parallel locator scheme.
 */

import type { CrossValidationReference } from "@/features/forever-cross-validation";
import type { ISODateTime } from "@/features/forever-database";

import type { ReadinessRequirement } from "./requirement";
import { readinessRequirementNecessity } from "./requirement";
import type { ReadinessSubjectStanding, ReadinessVerdict } from "./verdict";

/**
 * One link from an evaluation back to what it read: an RC4.5 fact, an RC4.4
 * catalogued source (and, when pinned, its received revision), or a
 * canonical field path. The RC4.7 reference shape, reused verbatim.
 */
export type ReadinessReference = CrossValidationReference;

/** What the examination concluded about one admissible stated requirement. */
export interface ReadinessEvaluation {
  /** Stable surrogate id, e.g. `reva_coralina-field-present-1`. */
  id: string;
  /**
   * The normalized statement this evaluation judged: the caller's demand
   * with only the effective necessity made explicit — never a re-stated or
   * re-scoped demand.
   */
  requirement: ReadinessRequirement;
  /** What the supplied inputs support — never more. */
  verdict: ReadinessVerdict;
  /** Why, in plain words. */
  reason: string;
  /**
   * What the judgement read, when anything was readable: canonical paths,
   * RC4.5 facts, RC4.4 sources and pinned revisions. Empty exactly when the
   * inputs needed to judge were never supplied — nothing consulted, nothing
   * to trace, and nothing invented.
   */
  references: ReadinessReference[];
  /**
   * The RC4.7 findings involved in the judgement, in the examination
   * report's finding order, when the report grounded it.
   */
  findingIds?: string[];
  /**
   * The RC4.8 epistemic standing observed for the addressed subject, when
   * the examination report judged it — the reused consensus mapping, never a
   * re-judgement.
   */
  standing?: ReadinessSubjectStanding;
  /** When the evaluation was described, supplied by the caller. */
  evaluatedAt?: ISODateTime;
}

/**
 * Whether an evaluation stands as a blocker: a statement that effectively
 * demands (only an explicit `recommended` excuses — the reused safe posture)
 * and is anything but `met`. An `indeterminate` required statement blocks in
 * description exactly like an `unmet` one is *reported* — but the two settle
 * into different report standings (`indeterminate` vs `blocked`), so this
 * helper answers "does something stand in the way", never "which way".
 */
export function isBlockingReadinessEvaluation(evaluation: ReadinessEvaluation): boolean {
  return (
    readinessRequirementNecessity(evaluation?.requirement) === "required" &&
    evaluation?.verdict !== "met"
  );
}

/** Whether an evaluation is advisory only — an explicit `recommended` demand. */
export function isAdvisoryReadinessEvaluation(evaluation: ReadinessEvaluation): boolean {
  return readinessRequirementNecessity(evaluation?.requirement) === "recommended";
}
