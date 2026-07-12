/**
 * Forever Knowledge Graph — the epistemic standing vocabulary.
 *
 * A {@link KnowledgeStanding} says what the graph actually knows about a
 * statement — and, deliberately, no more than the underlying evidence says.
 * The vocabulary is built to *preserve* uncertainty: `corroborated` is stated
 * only when the reused RC4.7 consensus judged independent agreement,
 * `disputed` keeps every side of a disagreement standing, `incomparable` says
 * agreement cannot even be judged (RC4.8 never normalizes its way to a
 * comparison), `stale` says the statement stands on superseded readings,
 * `unavailable` says the sources themselves state the value is not there,
 * `missing` says nothing addresses the statement at all, and `unverified` is
 * the explicit default for everything nothing has judged. No standing is ever
 * invented: every value above `unverified` traces to a reused RC4.5 fact
 * status or RC4.7 consensus — a graph edge can never silently imply certainty
 * beyond the underlying evidence.
 */

import type { CrossValidationConsensus } from "@/features/forever-cross-validation";

/** What the graph knows about one statement — never more than the evidence. */
export type KnowledgeStanding =
  | "corroborated"
  | "unverified"
  | "disputed"
  | "incomparable"
  | "stale"
  | "unavailable"
  | "missing";

/** Every {@link KnowledgeStanding}, in a stable declared order. */
export const KNOWLEDGE_STANDINGS = [
  "corroborated",
  "unverified",
  "disputed",
  "incomparable",
  "stale",
  "unavailable",
  "missing",
] as const satisfies readonly KnowledgeStanding[];

/** Runtime guard: whether a value is a known {@link KnowledgeStanding}. */
export function isKnownKnowledgeStanding(value: unknown): value is KnowledgeStanding {
  return typeof value === "string" && (KNOWLEDGE_STANDINGS as readonly string[]).includes(value);
}

/**
 * The explicit default standing: nothing has judged the statement, and no
 * judgement is fabricated. Stated as a constant so the default is a
 * vocabulary value, never an accidental blank.
 */
export const UNVERIFIED_KNOWLEDGE_STANDING: KnowledgeStanding = "unverified";

/**
 * The standing the reused RC4.7 consensus maps to — the graph re-expresses
 * the cross-source judgement, it never re-judges:
 *
 * - `corroborated` → `corroborated` (independent sources agreed);
 * - `uncorroborated` → `unverified` (one source, or only dependent sources);
 * - `contested` → `disputed` (every side kept standing, none chosen);
 * - `incomparable` → `incomparable` (agreement could not even be judged);
 * - `unaddressed` → `missing` (nothing speaks at all).
 *
 * Total: an out-of-vocabulary runtime value maps to the explicit `unverified`
 * default — a malformed judgement never fabricates certainty.
 */
export function knowledgeStandingForConsensus(
  consensus: CrossValidationConsensus,
): KnowledgeStanding {
  switch (consensus) {
    case "corroborated":
      return "corroborated";
    case "uncorroborated":
      return "unverified";
    case "contested":
      return "disputed";
    case "incomparable":
      return "incomparable";
    case "unaddressed":
      return "missing";
    default:
      return "unverified";
  }
}

/**
 * Whether a standing marks an unresolved disagreement a human or a future
 * runtime must settle — the graph itself settles nothing. `disputed` and
 * `incomparable` are the two standings that describe an active, unresolved
 * tension; `stale`, `unavailable`, `missing`, and `unverified` describe
 * absence or age rather than contention.
 */
export function knowledgeStandingRequiresReview(standing: KnowledgeStanding): boolean {
  return standing === "disputed" || standing === "incomparable";
}

/**
 * Whether a standing states settled, independently corroborated knowledge.
 * Only `corroborated` qualifies — everything else preserves some uncertainty,
 * and saying so is the point.
 */
export function isSettledKnowledgeStanding(standing: KnowledgeStanding): boolean {
  return standing === "corroborated";
}
