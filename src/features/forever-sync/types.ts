/**
 * Forever Sync (RC3.2) — canonical sync types.
 *
 * These are the system-agnostic shapes every future synchronization path
 * (Website, CRM, Forever Database, Marketplace, AI Agents, Manual, and future
 * API providers) shares. RC3.2 is the *foundation* synchronization stands on:
 * it describes what a sync job is, where it reads from, where it writes to, and
 * how a run reports its result — without moving a single record.
 *
 * The types deliberately reuse the Forever Database (RC3.0) canonical models as
 * the unit of exchange and the Forever Import (RC3.1) contracts as the way a
 * payload is validated, so a sync run speaks the same language Discovery,
 * Navigator, Advisory, and the import pipeline already consume. Nothing here
 * performs IO, HTTP, scheduling, or persistence; it is architecture only.
 */

import type { ISODateTime } from "@/features/forever-database";
import type { ImportSeverity, ImportSourceKind } from "@/features/forever-import";

/**
 * The systems Forever can synchronize with.
 *
 * The list is closed for the systems RC3.2 must support today; a future
 * third-party provider connects through `"api"` without changing the
 * foundation, keeping the module additive.
 */
export type SyncSystem =
  | "website"
  | "crm"
  | "forever_database"
  | "marketplace"
  | "ai_agents"
  | "manual"
  | "api";

/** Direction of data flow relative to the Forever Database. */
export type SyncDirection = "pull" | "push" | "bidirectional";

/**
 * The canonical entity kinds a sync job moves.
 *
 * Reuses the Forever Import (RC3.1) kinds verbatim so a synced entity is
 * exactly an imported entity — no parallel taxonomy to drift out of sync.
 */
export type SyncEntityKind = ImportSourceKind;

/**
 * The transport a future connector will speak.
 *
 * Metadata only: RC3.2 never opens a socket, reads a file, or dispatches a
 * webhook. The value simply lets tooling and validation reason about a
 * connector before any transport exists.
 */
export type SyncProtocol = "http" | "graphql" | "webhook" | "file" | "memory" | "manual";

/**
 * A description of one side of a sync — where records are read from or written
 * to.
 *
 * This is metadata only: an `origin` is an opaque label (a URL, a table name, a
 * connector id) that the foundation never dereferences. Fetching, pushing, and
 * authentication all live outside RC3.2.
 */
export interface SyncEndpoint {
  /** Stable identifier for the endpoint, e.g. `website_projects`. */
  id: string;
  system: SyncSystem;
  protocol: SyncProtocol;
  /** Human-readable label shown in tooling and provenance. */
  label: string;
  /** Opaque origin (URL, table, connector name). Never dereferenced. */
  origin?: string;
}

/** The endpoint a sync job reads canonical records from. */
export interface SyncSource extends SyncEndpoint {
  role: "source";
}

/** The endpoint a sync job writes canonical records to. */
export interface SyncTarget extends SyncEndpoint {
  role: "target";
}

/**
 * A single unit of synchronization: move one {@link SyncEntityKind} from a
 * {@link SyncSource} to a {@link SyncTarget} in one {@link SyncDirection}.
 *
 * Policy and triggers are referenced by id rather than embedded so a job stays
 * a small, declarative record; the {@link import("./validation").SyncPlan}
 * resolves those references during validation.
 */
export interface SyncJob {
  id: string;
  name: string;
  direction: SyncDirection;
  entityKind: SyncEntityKind;
  source: SyncSource;
  target: SyncTarget;
  /** References the {@link import("./policy").SyncPolicy} governing the job. */
  policyId?: string;
  /** References the {@link import("./schedule").SyncTrigger}s that start the job. */
  triggerIds?: string[];
  enabled: boolean;
}

/** Whether an issue blocks the sync (`error`) or merely annotates it (`warning`). */
export type SyncSeverity = ImportSeverity;

/**
 * A single structured issue raised while planning or validating a sync.
 *
 * Issues are never thrown — the foundation returns them so callers decide how
 * to react. `path` is a dotted locator into the offending structure, e.g.
 * `job.source.id`.
 */
export interface SyncIssue {
  code: string;
  message: string;
  path?: string;
  severity: SyncSeverity;
}

/** A non-blocking issue: the sync can still proceed. */
export interface SyncWarning extends SyncIssue {
  severity: "warning";
}

/** A blocking issue: the sync must not proceed as-is. */
export interface SyncError extends SyncIssue {
  severity: "error";
}

/**
 * Per-run configuration threaded through the whole foundation.
 *
 * The clock (`now`) is supplied by the caller so the foundation stays
 * deterministic: identical inputs and context always produce identical output.
 * No `Date.now()`, no ambient locale.
 */
export interface SyncContext {
  job: SyncJob;
  /** Deterministic timestamp for provenance; the foundation reads no wall clock. */
  now?: ISODateTime;
}

/** Deterministic counters describing what a run planned. */
export interface SyncStats {
  /** Candidate records seen for synchronization. */
  total: number;
  /** Records that would be written to the target. */
  synced: number;
  /** Records intentionally skipped (e.g. already in sync). */
  skipped: number;
  /** Records dropped because they raised a blocking error. */
  failed: number;
  /** Records whose source and target disagree under the active policy. */
  conflicts: number;
  warnings: number;
  errors: number;
}

/**
 * Provenance attached to the output of one sync run.
 *
 * `direction` and `recordCount` mirror the job so a caller can read the
 * headline facts without re-deriving them from the job.
 */
export interface SyncMetadata {
  job: SyncJob;
  /** Set from {@link SyncContext.now} when present; otherwise omitted. */
  syncedAt?: ISODateTime;
  direction: SyncDirection;
  recordCount: number;
}

/**
 * The result of planning one sync run over a single job.
 *
 * Generic over the canonical entity type moved. `ok` is `true` only when no
 * blocking {@link SyncError} was raised; `data` then holds the records the run
 * would synchronize. `status` and `outcome` are derived deterministically from
 * the stats so they can never disagree with the counters.
 */
export interface SyncResult<T> {
  ok: boolean;
  status: import("./status").SyncStatus;
  outcome: import("./status").SyncOutcome;
  data: T[];
  errors: SyncError[];
  warnings: SyncWarning[];
  stats: SyncStats;
  metadata: SyncMetadata;
}
