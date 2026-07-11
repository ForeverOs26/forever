/**
 * Forever Source Registry (RC3.3) — the source registry foundation.
 *
 * This module is the architecture every future source will be described with. It
 * is not a source itself: it ships no HTTP client, API client, parser, scraper,
 * OCR, synchronizer, worker, queue, runtime registry, Supabase access, or UI. It
 * never reads a clock, opens a connection, or loads a byte of data. It defines
 * the canonical source vocabulary (types, categories, capabilities, priority,
 * trust, lifecycle, status), the identity/version/metadata descriptors, the
 * {@link SourceDefinition} that ties them together, the registry models and a
 * pluggable provider contract, a deterministic in-memory registry, a validation
 * pipeline, and the pure helpers the whole module shares.
 *
 * It builds additively on the Forever Database (RC3.0) canonical id/slug types,
 * the Forever Import (RC3.1) entity taxonomy, and the Forever Sync (RC3.2) system
 * and direction vocabularies — reusing them rather than duplicating them — and
 * changes no existing behaviour.
 *
 * The architecture is shaped to describe every future source: the Developer
 * Website, CRM, Marketplace, Forever Database, Manual Entry, PDF, Excel, CSV,
 * JSON, API, AI Agent, and future providers, all through the same definition and
 * provider seam.
 */

export * from "./types";
export * from "./enums";
export * from "./capability";
export * from "./priority";
export * from "./trust";
export * from "./lifecycle";
export * from "./identity";
export * from "./version";
export * from "./metadata";
export * from "./definition";
export * from "./entry";
export * from "./result";
export * from "./helpers";
export * from "./registry";
export * from "./contracts";
export * from "./validation";
