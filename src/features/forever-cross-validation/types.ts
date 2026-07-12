/**
 * Forever Cross-Source Validation (RC4.7) — shared primitive types and the
 * reuse hub.
 *
 * RC4.4 catalogued the documents a project receives, RC4.5 described how those
 * documents produce structured extracted facts, and RC4.6 described the
 * canonical database those facts settle into. RC4.7 adds the missing judgement
 * *between* them: the deterministic cross-source examination of a batch of
 * extracted facts against the registered sources they trace to — which
 * readings independent sources corroborate, which they contest, which are
 * outdated revisions, which are duplicated, which lack evidence or provenance,
 * and which claims nothing supports — described as findings for a future
 * runtime or a human to act on, never resolved here.
 *
 * This module is architecture only. It ships no parser, OCR, AI or LLM call,
 * HTTP or API client, Supabase access, database write, filesystem access,
 * queue, worker, scheduler, route, or React. It never reads a clock, opens a
 * connection, persists a byte, normalizes a value, or picks a winner between
 * disagreeing sources — it *describes* cross-source validation, never a
 * running referee.
 *
 * This file is the reuse hub. Every primitive RC4.7 needs already exists in a
 * neighbouring foundation, so RC4.7 re-exports rather than restates: the id
 * type, issue/severity vocabulary, issue constructors, metadata, confidence,
 * evidence, provenance, and structured-value machinery all come from the
 * Forever Canonical Project Database (RC4.6), which itself reuses the Forever
 * Extraction Pipeline (RC4.5), Forever Project Sources (RC4.4), Forever Source
 * Registry (RC3.3), Forever Import (RC3.1), and Forever Database (RC3.0)
 * foundations. Reusing the RC4.6 machinery is what keeps RC4.7 from ever
 * duplicating identity, issue, source, fact, version, or value logic.
 */

import type {
  ProjectConfidence,
  ProjectConfidenceLevel,
  ProjectDatabaseError,
  ProjectDatabaseId,
  ProjectDatabaseIssue,
  ProjectDatabaseMetadata,
  ProjectDatabaseSeverity,
  ProjectDatabaseWarning,
  ProjectEvidence,
  ProjectFactId,
  ProjectProvenance,
  ProjectSourceRef,
  ProjectStructuredValue,
} from "@/features/forever-project-database";

/**
 * Stable identifier for a cross-validation entity. Reuses the RC4.6 id type
 * (itself the RC4.5 `ExtractionId`, itself the RC4.4 `ProjectSourceId`, itself
 * the RC3.3 `SourceId`, itself the RC3.0 `ForeverId`).
 */
export type CrossValidationId = ProjectDatabaseId;

/**
 * The id of one RC4.5 extracted fact a finding or standing traces back to.
 * Reused directly — a cross-validation finding references the very fact the
 * extraction pipeline described, never a parallel reference scheme.
 */
export type CrossFactId = ProjectFactId;

/**
 * The id of one RC4.4 catalogued source a reading or finding traces back to.
 * Reused directly.
 */
export type CrossSourceRef = ProjectSourceRef;

/**
 * Whether an issue blocks a report from being treated as coherent (`error`)
 * or merely annotates it (`warning`). Reuses the RC3.1 severity vocabulary
 * through RC3.3/RC4.4/RC4.5/RC4.6 so a cross-validation issue partitions by
 * the same rule every other foundation's issues do.
 */
export type CrossValidationSeverity = ProjectDatabaseSeverity;

/**
 * A single structured issue raised while describing or validating readings,
 * findings, assessments, reports, or catalogues.
 *
 * Reuses the RC4.6 issue shape (itself the RC4.5/RC4.4/RC3.3 one) so RC4.7
 * never restates the issue vocabulary. Issues are never thrown — the
 * foundation returns them so callers decide how to react. `path` is a dotted
 * locator into the offending structure, e.g. `findings.2.references.0.factId`.
 */
export type CrossValidationIssue = ProjectDatabaseIssue;

/** A blocking issue: the entity must not be treated as coherent as-is. */
export type CrossValidationError = ProjectDatabaseError;

/** A non-blocking issue: the entity can still be described. */
export type CrossValidationWarning = ProjectDatabaseWarning;

/**
 * Descriptive metadata about a cross-validation report — owner, region, tags,
 * caller-supplied timestamps. Reuses the RC4.6 shape (itself the
 * RC4.5/RC4.4/RC3.3 one) verbatim, so a report's tags live exactly where a
 * canonical record's tags do.
 */
export type CrossValidationMetadata = ProjectDatabaseMetadata;

/**
 * How sure the extraction that produced a reading was of what it read. The
 * RC4.5 confidence shape carried through RC4.6, reused wholesale — a reading
 * is examined under the very confidence grade its fact carried, never a
 * re-graded copy.
 */
export type CrossValidationConfidence = ProjectConfidence;

/** The RC4.5 confidence ladder, reused under a cross-validation name. */
export type CrossValidationConfidenceLevel = ProjectConfidenceLevel;

/**
 * Where a reading was observed. The RC4.5 evidence shape carried through
 * RC4.6, reused directly — findings point at the same page, sheet, section,
 * frame, cell, or region the extraction did, never a parallel locator scheme.
 */
export type CrossValidationEvidence = ProjectEvidence;

/**
 * The chain from one reading back to the catalogued source, revision, method,
 * and caller-supplied extraction time. The RC4.5 provenance shape carried
 * through RC4.6, reused directly.
 */
export type CrossValidationProvenance = ProjectProvenance;

/**
 * The typed representation a reading carries: a scalar, a list of scalars, an
 * RC3.0 `Money`, or an RC3.0 `GeoPoint`. The RC4.5 shape carried through
 * RC4.6, reused directly so RC4.7 examines exactly what was extracted.
 */
export type CrossValidationStructuredValue = ProjectStructuredValue;

// Re-export the reused constructors and value helpers under cross-validation
// names so the whole cross-validation API is available from this one module —
// without ever re-implementing the issue, confidence, or structured-value
// logic they carry. The canonical-database names are themselves re-exports of
// the RC4.5/RC4.4/RC3.3 machinery, so RC4.7 → RC4.6 → RC4.5 → RC4.4 → RC3.3
// all share one implementation.
export {
  projectDatabaseError as crossValidationError,
  projectDatabaseWarning as crossValidationWarning,
  partitionProjectDatabaseIssues as partitionCrossValidationIssues,
  projectConfidence as crossValidationConfidence,
  unknownProjectConfidence as unknownCrossValidationConfidence,
  isKnownProjectConfidenceLevel as isKnownCrossValidationConfidenceLevel,
  isProjectStructuredValue as isCrossValidationStructuredValue,
} from "@/features/forever-project-database";
