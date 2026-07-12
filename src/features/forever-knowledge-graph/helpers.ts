/**
 * Forever Knowledge Graph — deterministic, immutable helpers.
 *
 * Pure, side-effect-free utilities shared across the foundation. Given the
 * same input they always return the same output — no randomness, no clocks,
 * no locale — so the whole module stays deterministic and these helpers never
 * need re-implementing per call site.
 *
 * The string and absence guards are reused verbatim from the Forever
 * Canonical Project Database (RC4.6) helpers (themselves the RC4.5/RC4.4
 * ones), the string comparison is the RC4.7 total code-unit rule, and the
 * stats combiners are the RC4.0 ones under knowledge-graph names — nothing is
 * restated.
 */

import { isAbsent, isNonEmptyString } from "@/features/forever-project-database";

export { isAbsent, isNonEmptyString };

// Reuse the RC4.7 pure, locale-independent, total code-unit comparison under
// a knowledge-graph name — the module's one string-ordering rule, never bent
// to the host locale and never a local variant.
export { compareCrossValidationStrings as compareKnowledgeStrings } from "@/features/forever-cross-validation";

// Reuse the RC4.0 stats combiners (through the RC4.6 re-export — the very
// same functions) under knowledge-graph names — the stats shape is the RC4.0
// one, so the arithmetic is too.
export {
  mergeProjectDatabaseStats as mergeKnowledgeStats,
  sumProjectDatabaseStats as sumKnowledgeStats,
} from "@/features/forever-project-database";
