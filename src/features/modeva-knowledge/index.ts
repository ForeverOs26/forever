/**
 * Modeva Knowledge (RC5.1) — the second real project stated for the generic
 * Project Knowledge engine.
 *
 *   supabase/migrations (FDB-001 seed, FDB-002C price-list import)
 *   docs (FDB-002D validation, FDB-003C real run)
 *     → ProjectKnowledgeDefinition      (this module — statements only)
 *     → buildProjectKnowledgeSlice      (the RC5.1 engine, RC4.4→RC4.9)
 *     → /internal/projects/modeva       (inspection page in the existing app)
 *
 * This module is data, not orchestration: it states Modeva's sources, facts,
 * gaps, declarations, and readiness profile, and the engine does the rest.
 * It never fabricates a value — missing information stays missing, and every
 * fact traces to a committed repository artifact.
 */

export * from "./identity";
export * from "./sources";
export * from "./facts";
export * from "./profile";
export * from "./definition";
