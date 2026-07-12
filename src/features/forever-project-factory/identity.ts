/**
 * Forever Project Factory — factory identity.
 *
 * A {@link FactoryIdentity} is the stable, human- and machine-addressable name
 * of a factory: its id, its URL-safe slug, a display name, and the
 * {@link FactoryScope} that classifies what its generated packages span. It
 * reuses the RC3.0 `Slug` and id types so a factory is addressed exactly the
 * way every other canonical Forever entity is — never a parallel scheme.
 *
 * The deterministic naming helpers reuse the RC4.2 {@link normalizeFactorySlug}
 * rule (itself the RC3.0 `slugify` rule) rather than restating any identity
 * logic. They take no clock, counter, or randomness, and therefore always
 * produce byte-identical ids — which is what makes a factory and its planned
 * builds safe to regenerate, diff, and validate. The ids a generated *package*
 * needs (`pkg_`, `proj_`, `integ_`) stay entirely with the RC4.2 helpers; RC4.3
 * adds only the factory- and build-facing prefixes.
 */

import type { Slug } from "@/features/forever-database";
import { normalizeProjectSlug } from "@/features/forever-project-template";

import type { FactoryId, FactoryScope } from "./types";

// Reuse the RC4.2 slug rule (itself RC3.0 `slugify`) under a factory-facing name
// — one normalization rule across the whole system, never a local variant.
export { normalizeProjectSlug as normalizeFactorySlug };

/** The stable identity of a factory. */
export interface FactoryIdentity {
  /** Stable surrogate id, e.g. `fact_forever-project`. */
  id: FactoryId;
  /** URL- and file-safe identifier, e.g. `forever-project`. */
  slug: Slug;
  /** Human-readable display name, e.g. `Forever Project Factory`. */
  name: string;
  /** What the factory's generated packages span. Reuses the RC4.0 scope. */
  scope: FactoryScope;
}

/** The id prefix conventions RC4.3 derives its ids from. */
export const FACTORY_ID_PREFIXES = {
  factory: "fact_",
  build: "build_",
} as const;

/** Deterministic factory id for a slug, e.g. `coralina` → `fact_coralina`. */
export function factoryIdForSlug(slug: string): FactoryId {
  return `${FACTORY_ID_PREFIXES.factory}${normalizeProjectSlug(slug)}`;
}

/** Deterministic planned-build id for a project slug, e.g. `coralina` → `build_coralina`. */
export function factoryBuildIdForSlug(slug: string): string {
  return `${FACTORY_ID_PREFIXES.build}${normalizeProjectSlug(slug)}`;
}

/** Options accepted by {@link deriveFactoryIdentity}. */
export interface DeriveFactoryIdentityOptions {
  /** Display name; defaults to the normalized slug when omitted. */
  name?: string;
  /** What the factory's packages span; defaults to `project`. */
  scope?: FactoryScope;
}

/**
 * Derive a full {@link FactoryIdentity} from a verified slug.
 *
 * Deterministic and total: the same slug always yields the same identity. The
 * display name defaults to the normalized slug (never fabricated from outside
 * the input) and the scope defaults to `project`.
 */
export function deriveFactoryIdentity(
  slug: string,
  options: DeriveFactoryIdentityOptions = {},
): FactoryIdentity {
  const normalized = normalizeProjectSlug(slug);
  return {
    id: factoryIdForSlug(normalized),
    slug: normalized,
    name: options.name ?? normalized,
    scope: options.scope ?? "project",
  };
}
