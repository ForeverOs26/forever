/**
 * Forever Canonical Project Database (RC4.6) — shared primitive types and the
 * reuse hub.
 *
 * RC4.5 described how a catalogued source produces structured extracted facts.
 * RC4.6 adds the canonical destination those facts settle into: the single
 * source of truth for every Forever project — its canonical fields, organized
 * by section, with every value's history, confidence, evidence, provenance,
 * revision, snapshot, and unresolved conflict described in one place.
 *
 * This module is architecture only. It ships no database, parser, OCR, AI or
 * LLM call, HTTP or API client, Supabase access, filesystem access, queue,
 * worker, scheduler, route, or React. It never reads a clock, opens a
 * connection, persists a byte, resolves a conflict, or derives a value — it
 * *describes* the canonical project database, never a running store.
 *
 * This file is the reuse hub. Every primitive RC4.6 needs already exists in a
 * neighbouring foundation, so RC4.6 re-exports rather than restates: the id
 * type, issue/severity vocabulary, issue constructors, and descriptive
 * metadata all come from the Forever Extraction Pipeline (RC4.5), which itself
 * reuses the Forever Project Sources registry (RC4.4), the Forever Source
 * Registry (RC3.3), Forever Import (RC3.1), and Forever Database (RC3.0)
 * foundations. Reusing the RC4.5 machinery is what keeps RC4.6 from ever
 * duplicating identity, issue, source, fact, or version logic.
 */

import type {
  ExtractionConfidence,
  ExtractionConfidenceLevel,
  ExtractionError,
  ExtractionEvidence,
  ExtractionFactId,
  ExtractionIssue,
  ExtractionMetadata,
  ExtractionProvenance,
  ExtractionSeverity,
  ExtractionStructuredValue,
  ExtractionWarning,
} from "@/features/forever-extraction-pipeline";
import type { ExtractionId } from "@/features/forever-extraction-pipeline";
import type { ProjectSourceId } from "@/features/forever-project-sources";

/**
 * Stable identifier for a canonical project-database entity. Reuses the RC4.5
 * id type (itself the RC4.4 `ProjectSourceId`, itself the RC3.3 `SourceId`,
 * itself the RC3.0 `ForeverId`).
 */
export type ProjectDatabaseId = ExtractionId;

/**
 * Stable identifier for one canonical project record. The same reused id
 * chain as {@link ProjectDatabaseId}; kept as its own alias so signatures say
 * which entity an id addresses.
 */
export type ProjectRecordId = ProjectDatabaseId;

/** Stable identifier for one canonical project field. The same reused chain. */
export type ProjectFieldId = ProjectDatabaseId;

/**
 * The id of one RC4.5 extracted fact a canonical value traces back to.
 * Reused directly — a canonical value references the very fact that produced
 * it, never a parallel reference scheme.
 */
export type ProjectFactId = ExtractionFactId;

/**
 * The id of one RC4.4 catalogued source a canonical value or record traces
 * back to. Reused directly.
 */
export type ProjectSourceRef = ProjectSourceId;

/**
 * Whether an issue blocks a record, field, or merge description from being
 * treated as coherent (`error`) or merely annotates it (`warning`). Reuses
 * the RC3.1 severity vocabulary through RC3.3/RC4.4/RC4.5 so a canonical
 * database issue partitions by the same rule every other foundation's issues
 * do.
 */
export type ProjectDatabaseSeverity = ExtractionSeverity;

/**
 * A single structured issue raised while describing or validating a canonical
 * record, field, revision, snapshot, merge, database, catalogue, or registry.
 *
 * Reuses the RC4.5 issue shape (itself the RC4.4/RC3.3 one) so RC4.6 never
 * restates the issue vocabulary. Issues are never thrown — the foundation
 * returns them so callers decide how to react. `path` is a dotted locator
 * into the offending structure, e.g. `fields.0.values.1.confidence`.
 */
export type ProjectDatabaseIssue = ExtractionIssue;

/** A blocking issue: the entity must not be treated as coherent as-is. */
export type ProjectDatabaseError = ExtractionError;

/** A non-blocking issue: the entity can still be described. */
export type ProjectDatabaseWarning = ExtractionWarning;

/**
 * Descriptive metadata about a canonical record — owner, region, tags,
 * caller-supplied timestamps. Reuses the RC4.5 shape (itself the RC4.4/RC3.3
 * one) verbatim, so a canonical record's tags live exactly where a catalogued
 * source's tags do.
 */
export type ProjectDatabaseMetadata = ExtractionMetadata;

/**
 * How sure the system is of one canonical value. The RC4.5 confidence shape
 * reused wholesale — a value settling into the canonical database carries the
 * very confidence grade its producing fact carried, never a re-graded copy.
 */
export type ProjectConfidence = ExtractionConfidence;

/** The RC4.5 confidence ladder, reused under a canonical-database name. */
export type ProjectConfidenceLevel = ExtractionConfidenceLevel;

/**
 * Where a canonical value was observed. The RC4.5 evidence shape reused
 * directly — the canonical database points at the same page, sheet, section,
 * frame, cell, or region the extraction did, never a parallel locator scheme.
 */
export type ProjectEvidence = ExtractionEvidence;

/**
 * The chain from one canonical value back to the catalogued source, revision,
 * method, and caller-supplied extraction time. The RC4.5 provenance shape
 * reused directly — the canonical database keeps the whole chain, verbatim.
 */
export type ProjectProvenance = ExtractionProvenance;

/**
 * The typed representation a canonical value carries: a scalar, a list of
 * scalars, an RC3.0 `Money`, or an RC3.0 `GeoPoint`. The RC4.5 shape reused
 * directly so a value settles into the database exactly as it was extracted.
 */
export type ProjectStructuredValue = ExtractionStructuredValue;

// Re-export the reused constructors and value helpers under canonical-database
// names so the whole project-database API is available from this one module —
// without ever re-implementing the issue, confidence, evidence, or provenance
// logic they carry. The extraction names are themselves re-exports of the
// RC4.4/RC3.3 machinery, so RC4.6 → RC4.5 → RC4.4 → RC3.3 all share one
// implementation.
export {
  extractionError as projectDatabaseError,
  extractionWarning as projectDatabaseWarning,
  partitionExtractionIssues as partitionProjectDatabaseIssues,
  extractionConfidence as projectConfidence,
  unknownExtractionConfidence as unknownProjectConfidence,
  isKnownExtractionConfidenceLevel as isKnownProjectConfidenceLevel,
  isExtractionStructuredValue as isProjectStructuredValue,
} from "@/features/forever-extraction-pipeline";
