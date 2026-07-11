/**
 * Forever Connectors (RC3.4) — shared primitive types.
 *
 * These are the connector-agnostic building blocks every descriptor in the
 * connector foundation is composed from. RC3.4 is the *foundation* every future
 * connector (Developer Website, CRM, Marketplace, Forever Database, Manual, PDF,
 * Excel, CSV, JSON, API, AI Agent, and future transports) is *described* with —
 * it moves no data, opens no connection, sends no request, reads no clock, and
 * holds no credential.
 *
 * The types deliberately reuse the neighbouring foundations so a connector
 * speaks the exact language the rest of Forever already consumes: the canonical
 * entities a connector carries are the Forever Import (RC3.1) kinds, and an
 * issue raised while describing a connector shares the RC3.1 severity vocabulary.
 * Identity is anchored on the Forever Database (RC3.0) id/slug types — never a
 * parallel scheme. Nothing here performs IO, HTTP, or persistence; it is
 * architecture only.
 */

import type { ForeverId } from "@/features/forever-database";
import type { ImportSeverity, ImportSourceKind } from "@/features/forever-import";

/** Stable identifier for a connector. Reuses the RC3.0 id type. */
export type ConnectorId = ForeverId;

/**
 * The canonical entity kinds a connector can carry.
 *
 * Reuses the Forever Import (RC3.1) kinds verbatim so a connected entity is
 * exactly an imported entity — no parallel taxonomy to drift out of sync.
 */
export type ConnectorEntityKind = ImportSourceKind;

/**
 * Whether an issue blocks a connector from being registered (`error`) or merely
 * annotates it (`warning`). Reuses the RC3.1 severity vocabulary so a connector
 * issue partitions by the same rule an import, sync, or source issue does.
 */
export type ConnectorSeverity = ImportSeverity;

/**
 * A single structured issue raised while describing or validating a connector.
 *
 * Issues are never thrown — the foundation returns them so callers decide how
 * to react. `path` is a dotted locator into the offending structure, e.g.
 * `identity.slug` or `configuration.fields.0.key`.
 */
export interface ConnectorIssue {
  code: string;
  message: string;
  path?: string;
  severity: ConnectorSeverity;
}

/** A non-blocking issue: the connector can still be registered. */
export interface ConnectorWarning extends ConnectorIssue {
  severity: "warning";
}

/** A blocking issue: the connector must not be registered as-is. */
export interface ConnectorError extends ConnectorIssue {
  severity: "error";
}
