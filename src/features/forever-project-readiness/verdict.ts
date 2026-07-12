/**
 * Forever Project Readiness — the verdict and standing vocabularies.
 *
 * A {@link ReadinessVerdict} says what one stated requirement's examination
 * concluded — and, deliberately, no more than the supplied inputs say. The
 * vocabulary is built to *preserve* uncertainty: `met` is stated only when
 * the reused RC4.6 record, RC4.7 report, or RC4.4 sources actually satisfy
 * the statement, `unmet` keeps the shortfall standing and described, and
 * `indeterminate` says the input needed to judge was never supplied — an
 * absent record, report, or source roster judges nothing, and no judgement
 * is fabricated from silence.
 *
 * A {@link ReadinessStanding} is what a whole report's evaluations amount
 * to: `blocked` when any required statement stands unmet, `indeterminate`
 * when nothing required stands unmet but something required could not be
 * judged (or nothing coherent was judged at all — readiness is never
 * presumed from an empty examination), and `ready` only when every required
 * statement is met. Nothing here approves anything: a `ready` standing is a
 * description a human or a future runtime acts on, never an action.
 *
 * The epistemic vocabulary an evaluation reports a subject in is the RC4.8
 * {@link import("@/features/forever-knowledge-graph").KnowledgeStanding},
 * reused wholesale together with its RC4.7 consensus mapping — a readiness
 * evaluation re-expresses the cross-source judgement in exactly the standing
 * the knowledge graph states for the same subject, never a re-judged copy.
 */

import type { KnowledgeStanding } from "@/features/forever-knowledge-graph";
import {
  isSettledKnowledgeStanding,
  knowledgeStandingRequiresReview,
} from "@/features/forever-knowledge-graph";

import type { ReadinessEvaluation } from "./evaluation";

/**
 * The epistemic standing an evaluation observed for a subject. The RC4.8
 * vocabulary, reused verbatim — one standing ladder across the knowledge
 * graph and the readiness gate, and nothing to drift out of sync.
 */
export type ReadinessSubjectStanding = KnowledgeStanding;

// Reuse the RC4.8 standing machinery — the vocabulary, the guard, the RC4.7
// consensus mapping, and the settled/review judgements — under readiness
// names. The very same functions: an evaluation's standing can never
// disagree with the standing the knowledge graph derives from the same
// examination.
export {
  KNOWLEDGE_STANDINGS as READINESS_SUBJECT_STANDINGS,
  UNVERIFIED_KNOWLEDGE_STANDING as UNVERIFIED_READINESS_SUBJECT_STANDING,
  isKnownKnowledgeStanding as isKnownReadinessSubjectStanding,
  knowledgeStandingForConsensus as readinessSubjectStandingForConsensus,
  isSettledKnowledgeStanding as isSettledReadinessSubjectStanding,
  knowledgeStandingRequiresReview as readinessSubjectStandingRequiresReview,
} from "@/features/forever-knowledge-graph";

/** What one stated requirement's examination concluded — never more. */
export type ReadinessVerdict = "met" | "unmet" | "indeterminate";

/** Every {@link ReadinessVerdict}, in a stable declared order. */
export const READINESS_VERDICTS = [
  "met",
  "unmet",
  "indeterminate",
] as const satisfies readonly ReadinessVerdict[];

/** Runtime guard: whether a value is a known {@link ReadinessVerdict}. */
export function isKnownReadinessVerdict(value: unknown): value is ReadinessVerdict {
  return typeof value === "string" && (READINESS_VERDICTS as readonly string[]).includes(value);
}

/** What a whole report's evaluations amount to — a description, never a go. */
export type ReadinessStanding = "ready" | "blocked" | "indeterminate";

/** Every {@link ReadinessStanding}, in a stable declared order. */
export const READINESS_STANDINGS = [
  "ready",
  "blocked",
  "indeterminate",
] as const satisfies readonly ReadinessStanding[];

/** Runtime guard: whether a value is a known {@link ReadinessStanding}. */
export function isKnownReadinessStanding(value: unknown): value is ReadinessStanding {
  return typeof value === "string" && (READINESS_STANDINGS as readonly string[]).includes(value);
}

/**
 * Judge what a list of evaluations amounts to. Pure, total, and
 * deterministic — and deliberately unable to approve anything.
 *
 * In order:
 *
 * - no coherent evaluation at all → `indeterminate`: readiness is never
 *   presumed from an empty (or unreadable) examination;
 * - any required evaluation standing `unmet` → `blocked`: one unmet
 *   required statement is a described blocker, never waived;
 * - any required evaluation standing `indeterminate` — or carrying a
 *   verdict outside the vocabulary, which is never trusted as met — →
 *   `indeterminate`;
 * - otherwise → `ready`.
 *
 * Necessity is read through the stated safe posture: only an explicit
 * `recommended` demotes a statement to advisory — an absent or malformed
 * necessity demands, it never quietly excuses. Total: a hole or malformed
 * entry in the list judges nothing and is skipped from the count of coherent
 * evaluations, so hostile input degrades to `indeterminate`, never to a
 * fabricated `ready`.
 */
export function readinessStandingFor(
  evaluations: readonly ReadinessEvaluation[],
): ReadinessStanding {
  const list = Array.isArray(evaluations) ? evaluations : [];
  let judged = 0;
  let indeterminate = false;
  for (const evaluation of list) {
    if (evaluation == null || typeof evaluation !== "object") continue;
    judged += 1;
    if (evaluation.requirement?.necessity === "recommended") continue;
    if (evaluation.verdict === "unmet") return "blocked";
    if (evaluation.verdict !== "met") indeterminate = true;
  }
  if (judged === 0) return "indeterminate";
  return indeterminate ? "indeterminate" : "ready";
}

/**
 * Deterministically pick the one subject standing an evaluation reports when
 * the examination judged several assessments of one canonical path.
 *
 * Precedence keeps the *most demanding* observation standing: an unresolved
 * tension (`disputed`, `incomparable` — the reused RC4.8 review rule) wins
 * over settled agreement (`corroborated` — the reused RC4.8 settled rule),
 * which wins over the absence-and-age standings in their declared order.
 * Nothing is averaged and nothing is dropped — the pick is a headline over
 * judgements that all stay described in the report's references.
 */
export function pickReadinessSubjectStanding(
  standings: readonly KnowledgeStanding[],
): KnowledgeStanding | undefined {
  const list = Array.isArray(standings) ? standings : [];
  const reviewed = list.find((standing) => knowledgeStandingRequiresReview(standing));
  if (reviewed !== undefined) return reviewed;
  const settled = list.find((standing) => isSettledKnowledgeStanding(standing));
  if (settled !== undefined) return settled;
  return list.length > 0 ? list[0] : undefined;
}
