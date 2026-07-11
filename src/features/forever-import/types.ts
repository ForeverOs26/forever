/**
 * Forever Import (RC3.1) — canonical import types.
 *
 * These are the source-agnostic shapes every future importer (PDF, Excel, CSV,
 * JSON, Website, CRM, Manual) shares. RC3.1 is the *foundation* the importers
 * stand on: it defines how a source is described, how a run reports its result,
 * and how issues surface — without importing a single byte of real data.
 *
 * The types deliberately reuse the Forever Database (RC3.0) canonical models as
 * the import target, so an import run produces the same records Discovery,
 * Navigator, and Advisory already consume. Nothing here performs IO, HTTP, or
 * persistence; it is architecture only.
 */

import type { CurrencyCode, ISODateTime } from "@/features/forever-database";

/** The four canonical entity kinds an import source can produce. */
export type ImportSourceKind = "project" | "developer" | "document" | "media";

/**
 * The concrete input formats a future {@link ImportAdapter} can implement.
 *
 * RC3.1 ships none of these implementations — the list is the contract that
 * lets later releases plug a real adapter in without touching the foundation.
 */
export type ImportFormat = "pdf" | "excel" | "csv" | "json" | "website" | "crm" | "manual";

/**
 * A description of *where* an import comes from.
 *
 * This is metadata only: an `origin` is an opaque label (a file name, a URL, a
 * CRM name) that the foundation never dereferences. Fetching, scraping, and
 * parsing all live outside RC3.1.
 */
export interface ImportSource {
  /** Stable identifier for the source, e.g. `developer_price_list`. */
  id: string;
  kind: ImportSourceKind;
  format: ImportFormat;
  /** Human-readable label shown in tooling and provenance. */
  label: string;
  /** Opaque origin (file name, URL, CRM name). Never fetched by the foundation. */
  origin?: string;
  /** When the source material was captured, supplied by the caller. */
  capturedAt?: ISODateTime;
}

/** Whether an issue blocks the import (`error`) or merely annotates it (`warning`). */
export type ImportSeverity = "error" | "warning";

/**
 * A single structured issue raised during import.
 *
 * Issues are never thrown — the pipeline returns them so callers decide how to
 * react. `path` is a dotted locator into the offending record, e.g.
 * `media.2.url`.
 */
export interface ImportIssue {
  code: string;
  message: string;
  path?: string;
  severity: ImportSeverity;
}

/** A non-blocking issue: the record can still be imported. */
export interface ImportWarning extends ImportIssue {
  severity: "warning";
}

/** A blocking issue: the record must not be imported as-is. */
export interface ImportError extends ImportIssue {
  severity: "error";
}

/**
 * Per-run configuration threaded through the whole pipeline.
 *
 * The clock (`now`) and currency are supplied by the caller so the foundation
 * stays deterministic: identical inputs and context always produce identical
 * output. No `Date.now()`, no ambient locale.
 */
export interface ImportContext {
  source: ImportSource;
  /** Deterministic timestamp for provenance; the foundation reads no wall clock. */
  now?: ISODateTime;
  /** Currency assumed when a source proves an amount but no currency. */
  defaultCurrency?: CurrencyCode;
}

/**
 * Provenance attached to the output of one import run.
 *
 * `adapter` records which format produced the records; `recordCount` mirrors
 * `stats.imported` for callers that only need the headline number.
 */
export interface ImportMetadata {
  source: ImportSource;
  /** Set from {@link ImportContext.now} when present; otherwise omitted. */
  importedAt?: ISODateTime;
  /** The adapter format that produced the records, e.g. `csv`. */
  adapter?: ImportFormat;
  recordCount: number;
}

/** Deterministic counters describing what a run did. */
export interface ImportStats {
  /** Candidate records seen in the source input. */
  total: number;
  /** Records that passed validation and are safe to persist. */
  imported: number;
  /** Records intentionally skipped (e.g. duplicates already known). */
  skipped: number;
  /** Records dropped because they raised a blocking error. */
  failed: number;
  warnings: number;
  errors: number;
}

/**
 * The result of one import run over a single source.
 *
 * Generic over the canonical entity type produced. `ok` is `true` only when no
 * blocking {@link ImportError} was raised; `data` then holds the records safe
 * to hand to the Forever Database.
 */
export interface ImportResult<T> {
  ok: boolean;
  data: T[];
  errors: ImportError[];
  warnings: ImportWarning[];
  stats: ImportStats;
  metadata: ImportMetadata;
}
