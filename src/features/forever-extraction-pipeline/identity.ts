/**
 * Forever Extraction Pipeline — extraction identity.
 *
 * An {@link ExtractionIdentity} is the stable, human- and machine-addressable
 * name of one extraction definition: its id, its URL-safe slug, and a display
 * name. It reuses the RC3.0 `Slug` and id types so an extraction pipeline is
 * addressed exactly the way every other canonical Forever entity is — never a
 * parallel scheme.
 *
 * The deterministic naming helpers reuse the RC4.4 slug rule (itself the
 * RC4.2/RC3.0 `slugify` rule) and the RC4.2 `proj_` project-id convention
 * rather than restating any identity logic. They take no clock, counter, or
 * randomness, and therefore always produce byte-identical ids — which is what
 * makes plans and facts safe to regenerate, diff, and validate. Plan and fact
 * ids can carry the catalogued source revision, mirroring the RC4.4
 * version-addressed `psrc_` ids, so a repeated extraction attempt against a
 * revision with different numeric parts never collides with an earlier one —
 * like the RC4.4 rule (and the reused version comparison), the id is blind to
 * the optional version `label`. The `xplan_`/`xfact_` prefixes are
 * deliberate: the plain `fact_` prefix already addresses RC4.3 factories, so
 * extraction ids stay unmistakably their own.
 */

import type { Slug } from "@/features/forever-database";
import { normalizeProjectSourceSlug } from "@/features/forever-project-sources";
import { projectCanonicalId } from "@/features/forever-project-template";

import type { ExtractionFactId, ExtractionId } from "./types";
import type { ExtractionSourceVersion } from "./version";

// Reuse the RC4.4 slug rule (itself RC4.2/RC3.0 `slugify`) under an
// extraction-facing name — one normalization rule across the whole system,
// never a local variant.
export { normalizeProjectSourceSlug as normalizeExtractionSlug };

// Reuse the RC4.2 `proj_` convention so a fact's project id is byte-identical
// to the id every other foundation derives for the same slug.
export { projectCanonicalId as extractionProjectId };

/** The stable identity of one extraction definition. */
export interface ExtractionIdentity {
  /** Stable surrogate id, e.g. `extr_forever-extraction`. */
  id: ExtractionId;
  /** URL- and file-safe identifier, e.g. `forever-extraction`. */
  slug: Slug;
  /** Human-readable display name, e.g. `Forever Extraction Pipeline`. */
  name: string;
}

/** The id prefix conventions RC4.5 derives its ids from. */
export const EXTRACTION_ID_PREFIXES = {
  definition: "extr_",
  plan: "xplan_",
  fact: "xfact_",
} as const;

/** Deterministic definition id for a slug, e.g. `forever-extraction` → `extr_forever-extraction`. */
export function extractionIdForSlug(slug: string): ExtractionId {
  return `${EXTRACTION_ID_PREFIXES.definition}${normalizeProjectSourceSlug(slug)}`;
}

/** Renders `-v1-0-0` for a version, or the empty string when none is addressed. */
function versionSuffix(version?: ExtractionSourceVersion): string {
  return version === undefined ? "" : `-v${version.major}-${version.minor}-${version.patch}`;
}

/**
 * Deterministic plan id for a project id, source slug, and optional source
 * revision, e.g. (`proj_coralina`, `price-list`, `1.0.0`) →
 * `xplan_proj-coralina-price-list-v1-0-0`.
 *
 * The revision participates in the id so planning against two received
 * revisions of the same document never collides — the plan is
 * source-version-aware by construction.
 */
export function extractionPlanIdFor(
  projectId: string,
  sourceSlug: string,
  version?: ExtractionSourceVersion,
): string {
  return `${EXTRACTION_ID_PREFIXES.plan}${normalizeProjectSourceSlug(
    projectId,
  )}-${normalizeProjectSourceSlug(sourceSlug)}${versionSuffix(version)}`;
}

/**
 * Deterministic fact id for a project slug, fact slug, and optional source
 * revision, e.g. (`coralina`, `price-1br`, `1.0.0`) →
 * `xfact_coralina-price-1br-v1-0-0`.
 *
 * The revision participates in the id so the same fact re-extracted from a
 * newer received revision is addressable on its own — repeated extraction
 * attempts coexist instead of colliding.
 */
export function extractionFactIdFor(
  projectSlug: string,
  factSlug: string,
  version?: ExtractionSourceVersion,
): ExtractionFactId {
  return `${EXTRACTION_ID_PREFIXES.fact}${normalizeProjectSourceSlug(
    projectSlug,
  )}-${normalizeProjectSourceSlug(factSlug)}${versionSuffix(version)}`;
}

/** Options accepted by {@link deriveExtractionIdentity}. */
export interface DeriveExtractionIdentityOptions {
  /** Display name; defaults to the normalized slug when omitted. */
  name?: string;
}

/**
 * Derive a full {@link ExtractionIdentity} from a verified slug.
 *
 * Deterministic and total: the same slug always yields the same identity. The
 * display name defaults to the normalized slug (never fabricated from outside
 * the input).
 */
export function deriveExtractionIdentity(
  slug: string,
  options: DeriveExtractionIdentityOptions = {},
): ExtractionIdentity {
  const normalized = normalizeProjectSourceSlug(slug);
  return {
    id: extractionIdForSlug(normalized),
    slug: normalized,
    name: options.name ?? normalized,
  };
}
