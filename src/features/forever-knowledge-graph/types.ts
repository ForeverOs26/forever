/**
 * Forever Knowledge Graph (RC4.8) — shared primitive types and the reuse hub.
 *
 * RC4.4 catalogued the documents a project receives, RC4.5 described how those
 * documents produce structured extracted facts, RC4.6 described the canonical
 * database those facts settle into, and RC4.7 described the cross-source
 * examination between them. RC4.8 adds the connective tissue *above* them: the
 * deterministic knowledge graph that represents verified relationships between
 * canonical project knowledge, sources, extracted facts, canonical fields,
 * entities, documents, locations, developers, units, claims, evidence,
 * provenance, conflicts, revisions, and validation findings — with uncertainty
 * preserved and every relationship traceable back to the artifact that states
 * it.
 *
 * This module is architecture only. It ships no parser, OCR, AI or LLM call,
 * HTTP or API client, Supabase access, database write, filesystem access,
 * queue, worker, scheduler, route, or React. It never reads a clock, opens a
 * connection, persists a byte, normalizes a value, resolves a conflict, or
 * approves anything — it *describes* a knowledge graph, never a running one.
 *
 * This file is the reuse hub. Every primitive RC4.8 needs already exists in a
 * neighbouring foundation, so RC4.8 re-exports rather than restates: the id
 * type, issue/severity vocabulary, issue constructors, metadata, confidence,
 * evidence, provenance, and structured-value machinery all come from the
 * Forever Canonical Project Database (RC4.6), which itself reuses the Forever
 * Extraction Pipeline (RC4.5), Forever Project Sources (RC4.4), Forever Source
 * Registry (RC3.3), Forever Import (RC3.1), and Forever Database (RC3.0)
 * foundations. Reusing the RC4.6 machinery is what keeps RC4.8 from ever
 * duplicating identity, issue, source, fact, version, or value logic.
 */

import type { ExtractionFact } from "@/features/forever-extraction-pipeline";
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
 * Stable identifier for a knowledge-graph entity. Reuses the RC4.6 id type
 * (itself the RC4.5 `ExtractionId`, itself the RC4.4 `ProjectSourceId`, itself
 * the RC3.3 `SourceId`, itself the RC3.0 `ForeverId`).
 */
export type KnowledgeGraphId = ProjectDatabaseId;

/**
 * One RC4.5 extracted fact, reused directly — the graph represents the very
 * shape the extraction pipeline produces, never a re-described copy.
 */
export type KnowledgeFact = ExtractionFact;

/**
 * The id of one RC4.5 extracted fact a node or edge traces back to. Reused
 * directly — a graph element references the very fact the extraction pipeline
 * described, never a parallel reference scheme.
 */
export type KnowledgeFactId = ProjectFactId;

/**
 * The id of one RC4.4 catalogued source a node or edge traces back to.
 * Reused directly.
 */
export type KnowledgeSourceRef = ProjectSourceRef;

/**
 * Whether an issue blocks a graph from being treated as coherent (`error`)
 * or merely annotates it (`warning`). Reuses the RC3.1 severity vocabulary
 * through RC3.3/RC4.4/RC4.5/RC4.6 so a knowledge-graph issue partitions by
 * the same rule every other foundation's issues do.
 */
export type KnowledgeSeverity = ProjectDatabaseSeverity;

/**
 * A single structured issue raised while describing or validating nodes,
 * edges, declarations, graphs, or catalogues.
 *
 * Reuses the RC4.6 issue shape (itself the RC4.5/RC4.4/RC3.3 one) so RC4.8
 * never restates the issue vocabulary. Issues are never thrown — the
 * foundation returns them so callers decide how to react. `path` is a dotted
 * locator into the offending structure, e.g. `edges.2.refs.0.factId`.
 */
export type KnowledgeIssue = ProjectDatabaseIssue;

/** A blocking issue: the entity must not be treated as coherent as-is. */
export type KnowledgeError = ProjectDatabaseError;

/** A non-blocking issue: the entity can still be described. */
export type KnowledgeWarning = ProjectDatabaseWarning;

/**
 * Descriptive metadata about a knowledge graph — owner, region, tags,
 * caller-supplied timestamps. Reuses the RC4.6 shape (itself the
 * RC4.5/RC4.4/RC3.3 one) verbatim, so a graph's tags live exactly where a
 * canonical record's tags do.
 */
export type KnowledgeMetadata = ProjectDatabaseMetadata;

/**
 * How sure the extraction that produced a grounded fact was of what it read.
 * The RC4.5 confidence shape carried through RC4.6, reused wholesale — an
 * edge carries the very confidence grade its grounding fact carried, never a
 * re-graded copy.
 */
export type KnowledgeConfidence = ProjectConfidence;

/** The RC4.5 confidence ladder, reused under a knowledge-graph name. */
export type KnowledgeConfidenceLevel = ProjectConfidenceLevel;

/**
 * Where a grounded fact was observed. The RC4.5 evidence shape carried
 * through RC4.6, reused directly — graph traceability points at the same
 * page, sheet, section, frame, cell, or region the extraction did, never a
 * parallel locator scheme. Evidence stays an attribute of the reused facts;
 * the graph reaches it through fact references rather than copying it.
 */
export type KnowledgeEvidence = ProjectEvidence;

/**
 * The chain from one grounded fact back to the catalogued source, revision,
 * method, and caller-supplied extraction time. The RC4.5 provenance shape
 * carried through RC4.6, reused directly and reached through fact references.
 */
export type KnowledgeProvenance = ProjectProvenance;

/**
 * The typed representation a grounded fact carries: a scalar, a list of
 * scalars, an RC3.0 `Money`, or an RC3.0 `GeoPoint`. The RC4.5 shape carried
 * through RC4.6, reused directly so RC4.8 represents exactly what was
 * extracted.
 */
export type KnowledgeStructuredValue = ProjectStructuredValue;

// Re-export the reused constructors and value helpers under knowledge-graph
// names so the whole knowledge-graph API is available from this one module —
// without ever re-implementing the issue, confidence, or structured-value
// logic they carry. The canonical-database names are themselves re-exports of
// the RC4.5/RC4.4/RC3.3 machinery, so RC4.8 → RC4.6 → RC4.5 → RC4.4 → RC3.3
// all share one implementation.
export {
  projectDatabaseError as knowledgeError,
  projectDatabaseWarning as knowledgeWarning,
  partitionProjectDatabaseIssues as partitionKnowledgeIssues,
  projectConfidence as knowledgeConfidence,
  unknownProjectConfidence as unknownKnowledgeConfidence,
  isKnownProjectConfidenceLevel as isKnownKnowledgeConfidenceLevel,
  isProjectStructuredValue as isKnowledgeStructuredValue,
} from "@/features/forever-project-database";
