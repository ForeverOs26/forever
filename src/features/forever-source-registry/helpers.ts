/**
 * Forever Source Registry — deterministic helpers.
 *
 * Pure, side-effect-free utilities shared across the foundation: a strict string
 * guard used by validation, stable key builders for identities and definitions,
 * and deterministic bridges from a {@link SourceType} to the neighbouring
 * Forever Import (RC3.1) format and Forever Sync (RC3.2) system vocabularies.
 * Given the same input they always return the same output — no randomness, no
 * clocks, no locale — so the whole module stays deterministic and these helpers
 * never need re-implementing per call site.
 */

import type { ImportFormat } from "@/features/forever-import";
import type { SyncSystem } from "@/features/forever-sync";

import type { SourceDefinition } from "./definition";
import type { SourceType } from "./enums";
import type { SourceIdentity } from "./identity";

/** True only for a non-empty, non-whitespace string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Stable key for an identity, independent of its surrogate id: `type:slug`. */
export function sourceIdentityKey(identity: SourceIdentity): string {
  return `${identity.type}:${identity.slug}`;
}

/** Stable natural key for a definition, derived from its identity. */
export function sourceDefinitionKey(definition: SourceDefinition): string {
  return sourceIdentityKey(definition.identity);
}

/**
 * The Forever Import (RC3.1) format a source type maps to, or `undefined` when
 * the type has no direct import format. A deterministic, partial bridge — it
 * reuses the RC3.1 vocabulary rather than inventing a parallel one.
 */
export function sourceTypeToImportFormat(type: SourceType): ImportFormat | undefined {
  switch (type) {
    case "pdf":
      return "pdf";
    case "excel":
      return "excel";
    case "csv":
      return "csv";
    case "json":
      return "json";
    case "developer_website":
      return "website";
    case "crm":
      return "crm";
    case "manual_entry":
      return "manual";
    default:
      return undefined;
  }
}

/**
 * The Forever Sync (RC3.2) system a source type maps to, or `undefined` when the
 * type has no direct sync system. A deterministic, partial bridge — it reuses
 * the RC3.2 vocabulary rather than inventing a parallel one.
 */
export function sourceTypeToSyncSystem(type: SourceType): SyncSystem | undefined {
  switch (type) {
    case "developer_website":
      return "website";
    case "crm":
      return "crm";
    case "marketplace":
      return "marketplace";
    case "forever_database":
      return "forever_database";
    case "manual_entry":
      return "manual";
    case "api":
      return "api";
    case "ai_agent":
      return "ai_agents";
    default:
      return undefined;
  }
}
