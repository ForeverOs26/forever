/**
 * Forever Canonical Project Database — record identity.
 *
 * A {@link ProjectRecordIdentity} is the stable, human- and machine-
 * addressable name of one canonical project record: its id, its URL-safe
 * slug, a display name, and the canonical id of the project it *is* the
 * record of. It reuses the RC3.0 `Slug` and id types so a canonical record is
 * addressed exactly the way every other canonical Forever entity is — never a
 * parallel scheme.
 *
 * The deterministic naming helpers reuse the RC4.5 slug rule (itself the
 * RC4.4/RC4.2/RC3.0 `slugify` rule) and the RC4.2 `proj_` project-id
 * convention rather than restating any identity logic. They take no clock,
 * counter, or randomness, and therefore always produce byte-identical ids —
 * which is what makes a canonical database safe to regenerate, diff, and
 * validate. Because every project has exactly one canonical record, the
 * record id is derived from the project slug alone; fields, revisions,
 * snapshots, and merges are addressed *within* the project by path or
 * sequence number, so repeated revisions and snapshots never collide.
 */

import type { Slug } from "@/features/forever-database";
import {
  extractionProjectId,
  normalizeExtractionSlug,
} from "@/features/forever-extraction-pipeline";

import type { ProjectFieldId, ProjectRecordId } from "./types";

// Reuse the RC4.5 slug rule (itself RC4.4/RC4.2/RC3.0 `slugify`) under a
// canonical-database-facing name — one normalization rule across the whole
// system, never a local variant.
export { normalizeExtractionSlug as normalizeProjectDatabaseSlug };

// Reuse the RC4.2 `proj_` convention (through the RC4.5 re-export — the very
// same function) so a record's project id is byte-identical to the id every
// other foundation derives for the same slug.
export { extractionProjectId as projectDatabaseProjectId };

/** The stable identity of one canonical project record. */
export interface ProjectRecordIdentity {
  /** Stable surrogate id, e.g. `prec_coralina`. */
  id: ProjectRecordId;
  /** URL- and file-safe identifier, e.g. `coralina`. */
  slug: Slug;
  /** Human-readable display name, e.g. `Coralina`. */
  name: string;
  /** Canonical id of the project this record is the record of, e.g. `proj_coralina`. */
  projectId: string;
}

/** The id prefix conventions RC4.6 derives its ids from. */
export const PROJECT_DATABASE_ID_PREFIXES = {
  database: "pdb_",
  record: "prec_",
  field: "pfld_",
  revision: "prev_",
  snapshot: "psnap_",
  merge: "pmrg_",
} as const;

/** Deterministic record id for a project slug, e.g. `coralina` → `prec_coralina`. */
export function projectRecordIdFor(projectSlug: string): ProjectRecordId {
  return `${PROJECT_DATABASE_ID_PREFIXES.record}${normalizeExtractionSlug(projectSlug)}`;
}

/**
 * Deterministic field id for a project slug and canonical field path, e.g.
 * (`coralina`, `pricing.basePrice`) → `pfld_coralina-pricing-baseprice`.
 *
 * The path participates in the id so every canonical field of a project is
 * addressable on its own, and the same path always derives the same id —
 * which is what lets a merge description name the field a fact would settle
 * into before the field exists.
 */
export function projectFieldIdFor(projectSlug: string, path: string): ProjectFieldId {
  return `${PROJECT_DATABASE_ID_PREFIXES.field}${normalizeExtractionSlug(
    projectSlug,
  )}-${normalizeExtractionSlug(path)}`;
}

/**
 * Deterministic revision id for a project slug and 1-based revision number,
 * e.g. (`coralina`, 2) → `prev_coralina-r2`. The sequence number participates
 * so repeated revisions never collide.
 */
export function projectRevisionIdFor(projectSlug: string, number: number): string {
  return `${PROJECT_DATABASE_ID_PREFIXES.revision}${normalizeExtractionSlug(
    projectSlug,
  )}-r${number}`;
}

/**
 * Deterministic snapshot id for a project slug and the revision number the
 * snapshot freezes, e.g. (`coralina`, 2) → `psnap_coralina-r2`.
 */
export function projectSnapshotIdFor(projectSlug: string, revisionNumber: number): string {
  return `${PROJECT_DATABASE_ID_PREFIXES.snapshot}${normalizeExtractionSlug(
    projectSlug,
  )}-r${revisionNumber}`;
}

/**
 * Deterministic merge id for a project slug and the revision number the merge
 * describes, e.g. (`coralina`, 2) → `pmrg_coralina-r2`.
 */
export function projectMergeIdFor(projectSlug: string, revisionNumber: number): string {
  return `${PROJECT_DATABASE_ID_PREFIXES.merge}${normalizeExtractionSlug(
    projectSlug,
  )}-r${revisionNumber}`;
}

/** Options accepted by {@link deriveProjectRecordIdentity}. */
export interface DeriveProjectRecordIdentityOptions {
  /** Display name; defaults to the normalized slug when omitted. */
  name?: string;
}

/**
 * Derive a full {@link ProjectRecordIdentity} from a verified project slug.
 *
 * Deterministic and total: the same slug always yields the same identity. The
 * display name defaults to the normalized slug (never fabricated from outside
 * the input) and the project id is derived through the reused RC4.2 `proj_`
 * convention.
 */
export function deriveProjectRecordIdentity(
  projectSlug: string,
  options: DeriveProjectRecordIdentityOptions = {},
): ProjectRecordIdentity {
  const normalized = normalizeExtractionSlug(projectSlug);
  return {
    id: projectRecordIdFor(normalized),
    slug: normalized,
    name: options.name ?? normalized,
    projectId: extractionProjectId(normalized),
  };
}
