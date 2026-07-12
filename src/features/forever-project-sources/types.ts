/**
 * Forever Project Sources (RC4.4) — shared primitive types and the reuse hub.
 *
 * RC3.3 described the source *systems* facts arrive through (Developer Website,
 * CRM, Marketplace, PDF, and so on). RC4.4 adds the canonical catalogue of the
 * *documents* those systems deliver into the Forever ecosystem: every price
 * list, brochure, floor plan, master plan, unit plan, contract, legal document,
 * marketing material, specification, and developer update a project's intake
 * receives, in every version it was received in.
 *
 * This module is architecture only. It ships no parser, OCR, reader, scraper,
 * HTTP or API client, Supabase access, database write, queue, worker,
 * scheduler, route, React, or AI. It never reads a clock, opens a connection,
 * holds a credential, loads a byte of file content, or moves a record — it
 * *describes* project sources, never an import pipeline.
 *
 * This file is the reuse hub. Every primitive RC4.4 needs already exists in a
 * neighbouring foundation, so RC4.4 re-exports rather than restates: the id
 * type, issue/severity vocabulary, issue constructors, origin-type vocabulary,
 * and descriptive metadata all come from the Forever Source Registry (RC3.3),
 * which itself reuses the Forever Database (RC3.0) and Forever Import (RC3.1)
 * foundations. Reusing the RC3.3 machinery is what keeps RC4.4 from ever
 * duplicating identity, issue, or vocabulary logic.
 */

import type {
  SourceError,
  SourceId,
  SourceIssue,
  SourceMetadata,
  SourceSeverity,
  SourceType,
  SourceWarning,
} from "@/features/forever-source-registry";

/**
 * Stable identifier for a catalogued project source. Reuses the RC3.3 id type
 * (itself the RC3.0 `ForeverId`).
 */
export type ProjectSourceId = SourceId;

/**
 * The RC3.3 source-system type a catalogued document arrived through
 * (`developer_website`, `crm`, `marketplace`, `manual_entry`, `pdf`, …).
 *
 * Reused verbatim so "where did this document come from" is answered in the
 * exact vocabulary the source-system registry already speaks — no parallel
 * taxonomy to drift out of sync.
 */
export type ProjectSourceOriginType = SourceType;

/**
 * Whether an issue blocks a source from being treated as coherent (`error`) or
 * merely annotates it (`warning`). Reuses the RC3.1 severity vocabulary through
 * RC3.3 so a project-source issue partitions by the same rule every other
 * foundation's issues do.
 */
export type ProjectSourceSeverity = SourceSeverity;

/**
 * A single structured issue raised while describing or validating a project
 * source, its relationships, or a catalogue.
 *
 * Reuses the RC3.3 issue shape so RC4.4 never restates the issue vocabulary.
 * Issues are never thrown — the foundation returns them so callers decide how
 * to react. `path` is a dotted locator into the offending structure, e.g.
 * `descriptor.documentType`.
 */
export type ProjectSourceIssue = SourceIssue;

/** A blocking issue: the source must not be treated as coherent as-is. */
export type ProjectSourceError = SourceError;

/** A non-blocking issue: the source can still be catalogued. */
export type ProjectSourceWarning = SourceWarning;

/**
 * Descriptive metadata about a catalogued source — owner, region, tags,
 * caller-supplied timestamps. Reuses the RC3.3 shape verbatim, so a document's
 * tags live exactly where a source system's tags do.
 */
export type ProjectSourceMetadata = SourceMetadata;

// Re-export the reused constructors and value helpers under project-source
// names so the whole project-source API is available from this one module —
// without ever re-implementing the issue or vocabulary logic they carry.
export {
  sourceError as projectSourceError,
  sourceWarning as projectSourceWarning,
  partitionSourceIssues as partitionProjectSourceIssues,
  SOURCE_TYPES as PROJECT_SOURCE_ORIGIN_TYPES,
  isKnownSourceType as isKnownProjectSourceOriginType,
} from "@/features/forever-source-registry";
