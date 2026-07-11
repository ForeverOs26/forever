/**
 * Forever Import (RC3.1) — the import foundation.
 *
 * This module is the infrastructure every future importer stands on. It is not
 * an importer itself: it ships no scraper, crawler, parser, HTTP client, or
 * Supabase access. It defines the canonical import types, a deterministic
 * normalizer pipeline, a validation pipeline, a pluggable adapter contract, and
 * the source abstraction through which external formats (PDF, Excel, CSV, JSON,
 * Website, CRM, Manual) will later connect.
 *
 * It builds additively on the Forever Database (RC3.0) canonical models and
 * changes no existing behaviour.
 */

export * from "./types";
export * from "./result";
export * from "./normalizers";
export * from "./validation";
export * from "./adapters";
export * from "./sources";
