/**
 * Forever Extraction Pipeline (RC4.5) — shared primitive types and the reuse hub.
 *
 * RC4.4 catalogued the *documents* a project receives — every price list,
 * brochure, floor plan, contract, and developer update, in every received
 * revision. RC4.5 adds the declarative description of how one of those
 * registered sources *produces structured extracted facts*: which recipe would
 * read it, which fact types it could yield, and what a produced fact must
 * carry — value, unit, language, confidence, evidence, and a mandatory
 * provenance chain back to the catalogued source and revision.
 *
 * This module is architecture only. It ships no OCR, PDF parser, spreadsheet
 * reader, image or video recognition, AI or LLM call, HTTP or API client,
 * Supabase access, database write, filesystem access, queue, worker,
 * scheduler, route, or React. It never reads a clock, opens a connection,
 * loads a byte of file content, normalizes a value, or approves a fact — it
 * *describes* extraction, never performs it.
 *
 * This file is the reuse hub. Every primitive RC4.5 needs already exists in a
 * neighbouring foundation, so RC4.5 re-exports rather than restates: the id
 * type, issue/severity vocabulary, issue constructors, and descriptive
 * metadata all come from the Forever Project Sources registry (RC4.4), which
 * itself reuses the Forever Source Registry (RC3.3), Forever Import (RC3.1),
 * and Forever Database (RC3.0) foundations. Reusing the RC4.4 machinery is
 * what keeps RC4.5 from ever duplicating identity, issue, source, or version
 * logic.
 */

import type {
  ProjectSourceError,
  ProjectSourceId,
  ProjectSourceIssue,
  ProjectSourceMetadata,
  ProjectSourceSeverity,
  ProjectSourceWarning,
} from "@/features/forever-project-sources";

/**
 * Stable identifier for an extraction definition. Reuses the RC4.4 id type
 * (itself the RC3.3 `SourceId`, itself the RC3.0 `ForeverId`).
 */
export type ExtractionId = ProjectSourceId;

/**
 * Stable identifier for one extracted fact. The same reused id chain as
 * {@link ExtractionId}; kept as its own alias so signatures say which of the
 * two an id addresses.
 */
export type ExtractionFactId = ProjectSourceId;

/**
 * Whether an issue blocks an extraction descriptor or fact from being treated
 * as coherent (`error`) or merely annotates it (`warning`). Reuses the RC3.1
 * severity vocabulary through RC3.3/RC4.4 so an extraction issue partitions by
 * the same rule every other foundation's issues do.
 */
export type ExtractionSeverity = ProjectSourceSeverity;

/**
 * A single structured issue raised while describing or validating an
 * extraction definition, recipe, plan, fact, or catalogue.
 *
 * Reuses the RC4.4 issue shape (itself the RC3.3 one) so RC4.5 never restates
 * the issue vocabulary. Issues are never thrown — the foundation returns them
 * so callers decide how to react. `path` is a dotted locator into the
 * offending structure, e.g. `facts.0.provenance.extractedAt`.
 */
export type ExtractionIssue = ProjectSourceIssue;

/** A blocking issue: the descriptor or fact must not be treated as coherent as-is. */
export type ExtractionError = ProjectSourceError;

/** A non-blocking issue: the descriptor or fact can still be described. */
export type ExtractionWarning = ProjectSourceWarning;

/**
 * Descriptive metadata about an extraction definition — owner, region, tags,
 * caller-supplied timestamps. Reuses the RC4.4 shape (itself the RC3.3 one)
 * verbatim, so an extraction pipeline's tags live exactly where a catalogued
 * source's tags do. Distinct from the RC3.0 `SourceMetadata` that annotates a
 * single imported record — the two answer different questions.
 */
export type ExtractionMetadata = ProjectSourceMetadata;

// Re-export the reused constructors and value helpers under extraction names
// so the whole extraction API is available from this one module — without ever
// re-implementing the issue logic they carry. The project-source names are
// themselves re-exports of the RC3.3 machinery, so RC4.5 → RC4.4 → RC3.3 all
// share one implementation.
export {
  projectSourceError as extractionError,
  projectSourceWarning as extractionWarning,
  partitionProjectSourceIssues as partitionExtractionIssues,
} from "@/features/forever-project-sources";
