/**
 * Forever Source Registry — source type and category enumerations.
 *
 * The closed vocabularies that classify *what* a source is. The list is fixed
 * for the systems RC3.3 must be able to describe today — Developer Website, CRM,
 * Marketplace, Forever Database, Manual Entry, PDF, Excel, CSV, JSON, API, and
 * AI Agent — plus an explicit `"unknown"` so a future provider that cannot yet
 * be classified is represented rather than dropped (anti-fabrication).
 *
 * These are types and pure, total mappings only. RC3.3 never dereferences a
 * source, opens a connection, or reads a byte; it defines the vocabulary a
 * future runtime will describe sources with.
 */

/**
 * The concrete kind of a source.
 *
 * `"unknown"` explicitly represents a future or unclassifiable provider so the
 * registry can describe it without fabricating a more specific type.
 */
export type SourceType =
  | "developer_website"
  | "crm"
  | "marketplace"
  | "forever_database"
  | "manual_entry"
  | "pdf"
  | "excel"
  | "csv"
  | "json"
  | "api"
  | "ai_agent"
  | "unknown";

/** Every {@link SourceType}, in a stable declared order. */
export const SOURCE_TYPES = [
  "developer_website",
  "crm",
  "marketplace",
  "forever_database",
  "manual_entry",
  "pdf",
  "excel",
  "csv",
  "json",
  "api",
  "ai_agent",
  "unknown",
] as const satisfies readonly SourceType[];

/**
 * The coarse family a source belongs to.
 *
 * Categories group many {@link SourceType}s that behave alike (all file formats
 * are `"file"`; a website and a marketplace are both web-facing but kept
 * distinct where the distinction matters). `"unknown"` mirrors the type escape
 * hatch.
 */
export type SourceCategory =
  | "internal_database"
  | "web"
  | "crm"
  | "marketplace"
  | "file"
  | "api"
  | "ai"
  | "manual"
  | "unknown";

/** Every {@link SourceCategory}, in a stable declared order. */
export const SOURCE_CATEGORIES = [
  "internal_database",
  "web",
  "crm",
  "marketplace",
  "file",
  "api",
  "ai",
  "manual",
  "unknown",
] as const satisfies readonly SourceCategory[];

/** Deterministic canonical category for each source type. */
const SOURCE_TYPE_CATEGORY: Record<SourceType, SourceCategory> = {
  developer_website: "web",
  crm: "crm",
  marketplace: "marketplace",
  forever_database: "internal_database",
  manual_entry: "manual",
  pdf: "file",
  excel: "file",
  csv: "file",
  json: "file",
  api: "api",
  ai_agent: "ai",
  unknown: "unknown",
};

/**
 * The canonical {@link SourceCategory} for a {@link SourceType}.
 *
 * Total and deterministic: every type maps to exactly one category, so a
 * definition's declared category can be checked against the type it claims.
 */
export function sourceCategoryForType(type: SourceType): SourceCategory {
  return SOURCE_TYPE_CATEGORY[type];
}

/** Runtime guard: whether a value is a known {@link SourceType}. */
export function isKnownSourceType(value: unknown): value is SourceType {
  return typeof value === "string" && (SOURCE_TYPES as readonly string[]).includes(value);
}

/** Runtime guard: whether a value is a known {@link SourceCategory}. */
export function isKnownSourceCategory(value: unknown): value is SourceCategory {
  return typeof value === "string" && (SOURCE_CATEGORIES as readonly string[]).includes(value);
}
