/**
 * The Coralina end-to-end vertical slice (RC5.0) — real Coralina data run
 * through the complete RC4.4–RC4.9 foundation chain.
 *
 * As of RC5.1 the orchestration lives in the project-agnostic engine
 * (`@/features/forever-project-knowledge`); this module states Coralina's
 * {@link CORALINA_KNOWLEDGE_DEFINITION} and delegates. The public API is
 * unchanged and every RC5.0 judgement and artifact is preserved (pinned by
 * the unchanged RC5.0 tests plus the RC5.1 golden-pin suite); the one
 * deliberate difference is that the RC4.4 chain-summary wording in the
 * inspection view is now project-agnostic.
 *
 * The slice adds NO parallel logic: every judgement (agreement, conflict,
 * admissibility, standing, verdict) is made by the foundations themselves.
 * Everything is pure and deterministic: fixed caller-stated clocks, no I/O,
 * no randomness. Building the slice twice yields deep-equal results.
 */

import {
  buildProjectKnowledgeSlice,
  type ProjectKnowledgeSlice,
  type ProjectKnowledgeSourceValidation,
  type ProjectKnowledgeWithheldFact,
} from "@/features/forever-project-knowledge";

import { CORALINA_KNOWLEDGE_DEFINITION } from "./definition";

/** A fact RC4.7 kept out of the canonical record, with the reason preserved. */
export type CoralinaWithheldFact = ProjectKnowledgeWithheldFact;

/** Per-source RC4.4 validation outcome. */
export type CoralinaSourceValidation = ProjectKnowledgeSourceValidation;

/** The complete, inspectable result of the Coralina RC4.4→RC4.9 chain. */
export type CoralinaKnowledgeSlice = ProjectKnowledgeSlice;

/**
 * Run real Coralina data through the complete RC4.4→RC4.9 chain.
 *
 * Pure and deterministic — same output on every call.
 */
export function buildCoralinaKnowledgeSlice(): CoralinaKnowledgeSlice {
  return buildProjectKnowledgeSlice(CORALINA_KNOWLEDGE_DEFINITION);
}
