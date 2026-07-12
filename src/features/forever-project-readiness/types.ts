/**
 * Forever Project Readiness (RC4.9) — shared primitive types and the reuse
 * hub.
 *
 * RC4.4 catalogued the documents a project receives, RC4.5 described how
 * those documents produce structured extracted facts, RC4.6 described the
 * canonical database those facts settle into, RC4.7 described the
 * cross-source examination between them, and RC4.8 described the knowledge
 * graph they add up to. RC4.9 adds the *exit gate* of that chain: the
 * deterministic readiness examination that judges — never approves — whether
 * a project's accumulated knowledge satisfies the requirements a caller
 * states, and describes exactly what stands in the way when it does not.
 *
 * This module is architecture only. It ships no parser, OCR, AI or LLM call,
 * HTTP or API client, Supabase access, database write, filesystem access,
 * queue, worker, scheduler, route, or React. It never reads a clock, opens a
 * connection, persists a byte, imports a project, or waives a requirement —
 * it *describes* a readiness examination, never a running gate.
 *
 * This file is the reuse hub. Every primitive RC4.9 needs already exists in
 * a neighbouring foundation, so RC4.9 re-exports rather than restates: the
 * id type, issue/severity vocabulary, issue constructors, metadata, and
 * confidence machinery all come from the Forever Canonical Project Database
 * (RC4.6), which itself reuses the Forever Extraction Pipeline (RC4.5),
 * Forever Project Sources (RC4.4), Forever Source Registry (RC3.3), Forever
 * Import (RC3.1), and Forever Database (RC3.0) foundations. Reusing the
 * RC4.6 machinery is what keeps RC4.9 from ever duplicating identity, issue,
 * source, fact, version, or confidence logic.
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
  ProjectFactId,
  ProjectSourceRef,
} from "@/features/forever-project-database";

/**
 * Stable identifier for a readiness entity. Reuses the RC4.6 id type (itself
 * the RC4.5 `ExtractionId`, itself the RC4.4 `ProjectSourceId`, itself the
 * RC3.3 `SourceId`, itself the RC3.0 `ForeverId`).
 */
export type ReadinessId = ProjectDatabaseId;

/**
 * The id of one RC4.5 extracted fact an evaluation traces to. Reused
 * directly — an evaluation references the very fact the extraction pipeline
 * described, never a parallel reference scheme.
 */
export type ReadinessFactId = ProjectFactId;

/**
 * The id of one RC4.4 catalogued source an evaluation traces to. Reused
 * directly.
 */
export type ReadinessSourceRef = ProjectSourceRef;

/**
 * Whether an issue blocks a report from being treated as coherent (`error`)
 * or merely annotates it (`warning`). Reuses the RC3.1 severity vocabulary
 * through RC3.3/RC4.4/RC4.5/RC4.6 so a readiness issue partitions by the
 * same rule every other foundation's issues do.
 */
export type ReadinessSeverity = ProjectDatabaseSeverity;

/**
 * A single structured issue raised while describing or validating
 * requirements, evaluations, profiles, reports, or catalogues.
 *
 * Reuses the RC4.6 issue shape (itself the RC4.5/RC4.4/RC3.3 one) so RC4.9
 * never restates the issue vocabulary. Issues are never thrown — the
 * foundation returns them so callers decide how to react. `path` is a dotted
 * locator into the offending structure, e.g. `evaluations.2.requirement.kind`.
 */
export type ReadinessIssue = ProjectDatabaseIssue;

/** A blocking issue: the entity must not be treated as coherent as-is. */
export type ReadinessError = ProjectDatabaseError;

/** A non-blocking issue: the entity can still be described. */
export type ReadinessWarning = ProjectDatabaseWarning;

/**
 * Descriptive metadata about a readiness profile — owner, region, tags,
 * caller-supplied timestamps. Reuses the RC4.6 shape (itself the
 * RC4.5/RC4.4/RC3.3 one) verbatim, so a profile's tags live exactly where a
 * canonical record's tags do.
 */
export type ReadinessMetadata = ProjectDatabaseMetadata;

/**
 * How sure the extraction that produced a canonical value was of what it
 * read. The RC4.5 confidence shape carried through RC4.6, reused wholesale —
 * a readiness bar grades the very confidence the canonical value carries,
 * never a re-graded copy.
 */
export type ReadinessConfidence = ProjectConfidence;

/** The RC4.5 confidence ladder, reused under a readiness name. */
export type ReadinessConfidenceLevel = ProjectConfidenceLevel;

// Re-export the reused constructors and guards under readiness names so the
// whole readiness API is available from this one module — without ever
// re-implementing the issue or confidence logic they carry. The
// canonical-database names are themselves re-exports of the RC4.5/RC4.4/RC3.3
// machinery, so RC4.9 → RC4.6 → RC4.5 → RC4.4 → RC3.3 all share one
// implementation.
export {
  projectDatabaseError as readinessError,
  projectDatabaseWarning as readinessWarning,
  partitionProjectDatabaseIssues as partitionReadinessIssues,
  projectConfidence as readinessConfidence,
  unknownProjectConfidence as unknownReadinessConfidence,
  isKnownProjectConfidenceLevel as isKnownReadinessConfidenceLevel,
} from "@/features/forever-project-database";

// Reuse the RC4.5 confidence-bar rule through the RC4.7 alias — the very
// judgement the cross-source examination applies its bars with, so a
// readiness confidence bar can never disagree with an examination one.
export { meetsCrossValidationConfidence as meetsReadinessConfidence } from "@/features/forever-cross-validation";
