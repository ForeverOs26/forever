/**
 * Forever Project Sources — source identity.
 *
 * A {@link ProjectSourceIdentity} is the stable, human- and machine-addressable
 * name of one catalogued source: its id, its URL-safe slug within the project,
 * a display name, and the canonical id of the project it belongs to. It reuses
 * the RC3.0 `Slug` and id types so a source is addressed exactly the way every
 * other canonical Forever entity is — never a parallel scheme.
 *
 * The deterministic naming helpers reuse the RC4.2 slug rule (itself the RC3.0
 * `slugify` rule) and the RC4.2 `proj_` project-id convention rather than
 * restating any identity logic. They take no clock, counter, or randomness, and
 * therefore always produce byte-identical ids — which is what makes a source
 * catalogue safe to regenerate, diff, and validate. Because the same document
 * may enter the ecosystem more than once, the source id can carry the version
 * so every received revision is addressable on its own.
 */

import type { Slug } from "@/features/forever-database";
import { normalizeProjectSlug, projectCanonicalId } from "@/features/forever-project-template";

import type { ProjectSourceId } from "./types";
import type { ProjectSourceVersion } from "./version";

// Reuse the RC4.2 slug rule (itself RC3.0 `slugify`) under a source-facing name
// — one normalization rule across the whole system, never a local variant.
export { normalizeProjectSlug as normalizeProjectSourceSlug };

/** The stable identity of one catalogued project source. */
export interface ProjectSourceIdentity {
  /** Stable surrogate id, e.g. `psrc_coralina-price-list-v1-0-0`. */
  id: ProjectSourceId;
  /** URL- and file-safe identifier within the project, e.g. `price-list`. */
  slug: Slug;
  /** Human-readable display name, e.g. `Coralina Price List`. */
  name: string;
  /** Canonical id of the project this source belongs to, e.g. `proj_coralina`. */
  projectId: string;
}

/** The id prefix conventions RC4.4 derives its ids from. */
export const PROJECT_SOURCE_ID_PREFIXES = {
  source: "psrc_",
} as const;

/**
 * Deterministic source id for a project slug, source slug, and optional
 * version, e.g. (`coralina`, `price-list`, `1.0.0`) →
 * `psrc_coralina-price-list-v1-0-0`.
 *
 * The version participates in the id so two received revisions of the same
 * document never collide; omitting it addresses the document irrespective of
 * revision.
 */
export function projectSourceIdFor(
  projectSlug: string,
  sourceSlug: string,
  version?: ProjectSourceVersion,
): ProjectSourceId {
  const base = `${PROJECT_SOURCE_ID_PREFIXES.source}${normalizeProjectSlug(
    projectSlug,
  )}-${normalizeProjectSlug(sourceSlug)}`;
  return version === undefined
    ? base
    : `${base}-v${version.major}-${version.minor}-${version.patch}`;
}

/** Options accepted by {@link deriveProjectSourceIdentity}. */
export interface DeriveProjectSourceIdentityOptions {
  /** Display name; defaults to the normalized source slug when omitted. */
  name?: string;
  /** Version to address; when supplied it participates in the derived id. */
  version?: ProjectSourceVersion;
}

/**
 * Derive a full {@link ProjectSourceIdentity} from a project's verified slug
 * and a source slug.
 *
 * Deterministic and total: the same input always yields the same identity. The
 * display name defaults to the normalized source slug (never fabricated from
 * outside the input) and the project id is derived through the reused RC4.2
 * `proj_` convention.
 */
export function deriveProjectSourceIdentity(
  projectSlug: string,
  sourceSlug: string,
  options: DeriveProjectSourceIdentityOptions = {},
): ProjectSourceIdentity {
  const normalized = normalizeProjectSlug(sourceSlug);
  return {
    id: projectSourceIdFor(projectSlug, normalized, options.version),
    slug: normalized,
    name: options.name ?? normalized,
    projectId: projectCanonicalId(projectSlug),
  };
}
