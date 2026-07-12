/**
 * Coralina Integration (RC4.1) — the first real project vertical slice.
 *
 * This module proves that the foundations built in RC3.0–RC4.0 can process one
 * real project, Coralina Kamala, end-to-end:
 *
 *   verified Coralina source data (`forever-data/projects/coralina/`)
 *     → Source Registry definitions   (RC3.3)
 *     → Import payload                 (RC3.1)
 *     → Forever Database record        (RC3.0)
 *     → Connector + Pipeline           (RC3.4 / RC3.5)
 *     → Project Integration definition (RC4.0)
 *     → cross-foundation reference resolution (closes the RC4.0 boundary)
 *     → existing Advisory derivations  (RC2.1–RC2.9, reused, unchanged)
 *     → deterministic verification result
 *
 * It builds no new foundation, summary, passport, scoring, or comparison engine —
 * it only wires Coralina through the existing ones. It ships no parser, OCR,
 * reader, scraper, HTTP, persistence, or route; every value it maps comes from
 * already-verified committed data, and any fact the source does not provide is
 * recorded as a gap and never fabricated.
 */

export * from "./identity";
export * from "./data";
export * from "./sources";
export * from "./adapters";
export * from "./integration";
export * from "./validation";
