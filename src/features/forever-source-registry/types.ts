/**
 * Forever Source Registry (RC3.3) — shared primitive types.
 *
 * These are the source-agnostic building blocks every descriptor in the source
 * registry is composed from. RC3.3 is the *foundation* every future source
 * (Developer Website, CRM, Marketplace, Forever Database, Manual Entry, PDF,
 * Excel, CSV, JSON, API, AI Agent, and future providers) is *described* with —
 * it moves no data, opens no connection, and reads no clock.
 *
 * The types deliberately reuse the Forever Import (RC3.1) taxonomy so a
 * registered source speaks the exact language the import and sync foundations
 * already consume: an entity a source supplies is an RC3.1 canonical entity, and
 * an issue raised while describing a source shares the RC3.1 severity vocabulary.
 * Nothing here performs IO, HTTP, or persistence; it is architecture only.
 */

import type { ForeverId } from "@/features/forever-database";
import type { ImportSeverity, ImportSourceKind } from "@/features/forever-import";

/** Stable identifier for a registered source. Reuses the RC3.0 id type. */
export type SourceId = ForeverId;

/**
 * The canonical entity kinds a source can supply.
 *
 * Reuses the Forever Import (RC3.1) kinds verbatim so a sourced entity is
 * exactly an imported entity — no parallel taxonomy to drift out of sync.
 */
export type SourceEntityKind = ImportSourceKind;

/**
 * Whether an issue blocks a source from being registered (`error`) or merely
 * annotates it (`warning`). Reuses the RC3.1 severity vocabulary so a source
 * issue partitions by the same rule an import or sync issue does.
 */
export type SourceSeverity = ImportSeverity;

/**
 * A single structured issue raised while describing or validating a source.
 *
 * Issues are never thrown — the foundation returns them so callers decide how
 * to react. `path` is a dotted locator into the offending structure, e.g.
 * `identity.slug`.
 */
export interface SourceIssue {
  code: string;
  message: string;
  path?: string;
  severity: SourceSeverity;
}

/** A non-blocking issue: the source can still be registered. */
export interface SourceWarning extends SourceIssue {
  severity: "warning";
}

/** A blocking issue: the source must not be registered as-is. */
export interface SourceError extends SourceIssue {
  severity: "error";
}
