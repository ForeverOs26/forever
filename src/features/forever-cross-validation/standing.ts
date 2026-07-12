/**
 * Forever Cross-Source Validation — the per-fact standing.
 *
 * A {@link CrossFactStanding} is the deterministic verdict the examination
 * hands the canonical database for one incoming fact: whether the fact is
 * `admissible` (nothing observed stands in its way), `requires_review` (it is
 * involved in at least one unresolved uncertainty — a conflict, an outdated
 * revision, a gap, a bar it does not clear — that a human or a future runtime
 * must settle first), or `inadmissible` (the fact is too malformed to be
 * examined at all). One standing per input slot, in input order, so every
 * fact of a batch is accounted for — a fact is marked, never silently
 * dropped, and a conflict marks *every* side `requires_review` rather than
 * electing a winner.
 *
 * This is the bridge into RC4.6: a future runtime feeds only `admissible`
 * facts to the canonical merge and routes the rest to review — but that
 * routing is the runtime's act. RC4.7 only describes.
 */

import type { CrossFactId } from "./types";

/** Whether one examined fact may proceed toward the canonical database. */
export type CrossFactAdmissibility = "admissible" | "requires_review" | "inadmissible";

/** Every {@link CrossFactAdmissibility}, in a stable declared order. */
export const CROSS_FACT_ADMISSIBILITIES = [
  "admissible",
  "requires_review",
  "inadmissible",
] as const satisfies readonly CrossFactAdmissibility[];

/** Runtime guard: whether a value is a known {@link CrossFactAdmissibility}. */
export function isKnownCrossFactAdmissibility(value: unknown): value is CrossFactAdmissibility {
  return (
    typeof value === "string" && (CROSS_FACT_ADMISSIBILITIES as readonly string[]).includes(value)
  );
}

/** The examination's verdict for one incoming fact. */
export interface CrossFactStanding {
  /**
   * The RC4.5 fact the standing concerns. Empty for an input slot too
   * malformed to carry a usable id — a stated blank the validator flags,
   * never an invented reference.
   */
  factId: CrossFactId;
  /** The reused RC4.5 subject key, when the fact declared enough to have one. */
  subjectKey?: string;
  admissibility: CrossFactAdmissibility;
  /** Every finding that concerns this fact, in the report's finding order. */
  findingIds: string[];
  /** Why the fact is inadmissible, when it is. */
  reason?: string;
}

/** Every standing with a given admissibility, in input order. */
export function listCrossFactStandings(
  standings: readonly CrossFactStanding[],
  admissibility: CrossFactAdmissibility,
): CrossFactStanding[] {
  return (Array.isArray(standings) ? standings : []).filter(
    (standing) => standing?.admissibility === admissibility,
  );
}
