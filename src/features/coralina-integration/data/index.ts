/**
 * Coralina verified data — the single source of truth for the vertical slice.
 *
 * Re-exports the hand-authored project-level facts and the generated,
 * verbatim-from-extraction unit, document, and media datasets. Everything the
 * rest of the module maps into canonical records originates here, and here
 * alone, so there is exactly one place any Coralina figure is written down.
 */

export * from "./coralina-facts";
export * from "./coralina-units.data";
export * from "./coralina-documents.data";
export * from "./coralina-media.data";
