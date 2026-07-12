/**
 * Coralina Knowledge (RC5.0) — the first end-to-end vertical slice through the
 * RC4.4–RC4.9 foundation chain, using real committed Coralina data.
 *
 *   forever-data/projects/coralina (committed source + extracted datasets)
 *     → RC4.4 Project Sources          (registered source definitions)
 *     → RC4.5 Extraction Pipeline      (plans + source-backed facts)
 *     → RC4.7 Cross-Source Validation  (consensus, findings, standings)
 *     → RC4.6 Canonical Database       (merge + canonical record)
 *     → RC4.8 Knowledge Graph          (claims, provenance, disputes)
 *     → RC4.9 Project Readiness        (caller-stated intake profile)
 *     → /internal/coralina             (inspection page in the existing app)
 *
 * The slice is a thin integration layer: it adds no parallel judgement logic,
 * no persistence, no parsing, and no runtime execution machinery. It never
 * fabricates a value — missing information stays missing, disputes stay
 * disputed, and every canonical field traces to its fact, source, and locator.
 */

// NOTE: the React page component is deliberately NOT re-exported here. The
// route deep-imports it (and dynamically imports ./inspection in its loader)
// so the foundation chain stays out of the application's shared client
// bundle; a barrel export coupling the component to the chain would defeat
// that split for any future consumer.
export * from "./identity";
export * from "./sources";
export * from "./facts";
export * from "./profile";
export * from "./definition";
export * from "./slice";
export * from "./inspection";
