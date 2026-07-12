/**
 * Forever Project Knowledge (RC5.1) — the project-agnostic engine over the
 * RC4.4–RC4.9 foundation chain.
 *
 *   ProjectKnowledgeDefinition (stated per project — sources, facts, gaps,
 *   declarations, readiness profile; statements only, never judgements)
 *     → buildProjectKnowledgeSlice        (RC4.4→RC4.9, one orchestration)
 *     → describeProjectKnowledgeInspection(serialisable view-model)
 *     → /internal/projects/$slug          (one inspection page for every project)
 *
 * RC5.0 proved the chain end-to-end for Coralina with hardcoded
 * orchestration; RC5.1 extracts that orchestration so onboarding a project
 * is the act of stating a definition, not writing engine code. The engine
 * adds no parallel judgement logic, no persistence, no parsing, and no
 * runtime execution machinery. It never fabricates a value — missing
 * information stays missing, disputes stay disputed, and every canonical
 * field traces to its fact, source, and locator.
 */

// NOTE: the React page component and the catalog are deliberately NOT
// re-exported here. The route deep-imports both (dynamically in its loader)
// so the foundation chain and per-project data stay out of the application's
// shared client bundle; a barrel export coupling them to the engine types
// would defeat that split for any future consumer.
export * from "./definition";
export * from "./slice";
export * from "./inspection";
