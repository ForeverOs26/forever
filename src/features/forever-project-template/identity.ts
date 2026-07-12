/**
 * Forever Project Template — template and package identity.
 *
 * A {@link ProjectTemplateIdentity} names the canonical template; a
 * {@link ProjectPackageIdentity} names one concrete project's package. Both reuse
 * the RC3.0 `Slug` and id types so a template and a package are addressed exactly
 * the way every other canonical Forever entity is — never a parallel scheme.
 *
 * The deterministic naming helpers here are the heart of RC4.2's promise: given a
 * project's verified slug, they derive every id the package needs (its package
 * id, canonical project id, integration id, and registry ids) by the *same*
 * conventions the Coralina slice used inline. They reuse the RC3.0
 * {@link slugify} rule rather than restating any identity logic, take no clock,
 * counter, or randomness, and therefore always produce byte-identical ids — which
 * is what makes a package safe to regenerate, diff, and validate.
 */

import { slugify, type Slug } from "@/features/forever-database";

import type { ProjectPackageId, ProjectPackageScope, ProjectTemplateId } from "./types";

/** The stable identity of the canonical template. */
export interface ProjectTemplateIdentity {
  /** Stable surrogate id, e.g. `tmpl_forever_project`. */
  id: ProjectTemplateId;
  /** URL- and file-safe identifier, e.g. `forever-project`. */
  slug: Slug;
  /** Human-readable display name, e.g. `Forever Project Template`. */
  name: string;
}

/** The stable identity of one concrete project's package. */
export interface ProjectPackageIdentity {
  /** Stable surrogate id, e.g. `pkg_coralina`. */
  id: ProjectPackageId;
  /** URL- and file-safe identifier, e.g. `coralina`. */
  slug: Slug;
  /** Human-readable display name, e.g. `Coralina`. */
  name: string;
  /** What the package spans. Reuses the RC4.0 scope. */
  scope: ProjectPackageScope;
}

/** The id prefix conventions RC4.2 derives every package id from. */
export const PROJECT_ID_PREFIXES = {
  package: "pkg_",
  project: "proj_",
  integration: "integ_",
} as const;

/**
 * Normalize a caller-supplied project slug through the RC3.0 slug rule.
 *
 * Reuses {@link slugify} so a package slug obeys exactly the Forever Database slug
 * contract (lowercase, hyphenated) and never a template-local variant.
 */
export function normalizeProjectSlug(value: string): Slug {
  return slugify(value);
}

/** Deterministic package id for a project slug, e.g. `coralina` → `pkg_coralina`. */
export function projectPackageId(slug: string): ProjectPackageId {
  return `${PROJECT_ID_PREFIXES.package}${normalizeProjectSlug(slug)}`;
}

/** Deterministic canonical project id for a slug, e.g. `coralina` → `proj_coralina`. */
export function projectCanonicalId(slug: string): string {
  return `${PROJECT_ID_PREFIXES.project}${normalizeProjectSlug(slug)}`;
}

/** Deterministic integration id for a slug, e.g. `coralina` → `integ_coralina`. */
export function projectIntegrationIdForSlug(slug: string): string {
  return `${PROJECT_ID_PREFIXES.integration}${normalizeProjectSlug(slug)}`;
}

/** Deterministic registry id for a slug and role, e.g. (`coralina`, `sources`) → `coralina-sources`. */
export function projectRegistryId(slug: string, role: string): string {
  return `${normalizeProjectSlug(slug)}-${role}`;
}

/** Options accepted by {@link deriveProjectPackageIdentity}. */
export interface DeriveProjectPackageIdentityOptions {
  /** Display name; defaults to the normalized slug when omitted. */
  name?: string;
  /** What the package spans; defaults to `project`. */
  scope?: ProjectPackageScope;
}

/**
 * Derive a full {@link ProjectPackageIdentity} from a project's verified slug.
 *
 * Deterministic and total: the same slug always yields the same identity. The
 * display name defaults to the normalized slug (never fabricated from outside the
 * input) and the scope defaults to `project`.
 */
export function deriveProjectPackageIdentity(
  slug: string,
  options: DeriveProjectPackageIdentityOptions = {},
): ProjectPackageIdentity {
  const normalized = normalizeProjectSlug(slug);
  return {
    id: projectPackageId(normalized),
    slug: normalized,
    name: options.name ?? normalized,
    scope: options.scope ?? "project",
  };
}
