/**
 * Owner Direct Publish — minimum publication requirements
 * (FOREVER-STUDIO-OWNER-DIRECT-PUBLISH-001).
 *
 * A project publishes as soon as Forever can build a truthful public record:
 * a name, a stable slug, at least one official source, and enough shape to
 * create the row. Everything else is optional and becomes null plus a warning.
 *
 * This module is the ONLY place a direct publication may be refused for content
 * reasons, and it refuses only for irreducible technical facts — never for
 * completeness, rights, or review. Keeping the whole "can this publish?"
 * decision in one small pure function is what stops new gates from creeping
 * back in one field at a time.
 */

import type {
  ProgressiveBatch,
  ProgressiveWarning,
  WarningEntity,
} from "../forever-ingestion/batch-types";

/** Same shape the database enforces for `projects.slug`. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

/**
 * The persisted review-queue vocabulary, mirroring the
 * `ingestion_warnings_entity_check` and severity CHECK constraints in
 * `20260718113000_progressive_ingestion_v1.sql`.
 *
 * `WarningEntity` already states this set in the type system, but a source
 * package is JSON read from disk at publish time, so nothing type-checks it. A
 * value outside the set aborts the whole publish transaction at its very last
 * step — after media has already been uploaded, and in a batch run after
 * earlier projects have already been written. Checking it here moves that
 * failure into `--dry-run`, where it costs nothing.
 *
 * The `satisfies` clause keeps this list and `WarningEntity` from drifting: a
 * value added to one and not the other stops compiling.
 */
const WARNING_ENTITY_LIST = [
  "project",
  "listing",
  "developer",
  "location",
  "building",
  "unit",
  "price",
  "media",
  "document",
] as const satisfies readonly WarningEntity[];

export const WARNING_ENTITIES: ReadonlySet<string> = new Set<string>(WARNING_ENTITY_LIST);

const WARNING_SEVERITY_LIST = [
  "info",
  "warning",
] as const satisfies readonly ProgressiveWarning["severity"][];

export const WARNING_SEVERITIES: ReadonlySet<string> = new Set<string>(WARNING_SEVERITY_LIST);

export interface PublishabilityFailure {
  code: string;
  message: string;
}

export type PublishabilityVerdict =
  | { ok: true; slug: string; name: string }
  | { ok: false; failure: PublishabilityFailure };

function hasOfficialSource(batch: ProgressiveBatch): boolean {
  // An official source is evidenced by field provenance carrying a source
  // reference, or by any priced/inventoried row citing a source file/ref.
  const provenance = batch.project.field_provenance ?? {};
  for (const entry of Object.values(provenance)) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.source_ref || entry.source_type) return true;
  }
  for (const price of batch.prices ?? []) {
    if (price.source_file || price.price_source) return true;
  }
  for (const row of [...(batch.buildings ?? []), ...(batch.units ?? [])]) {
    const metadata = row.metadata as Record<string, unknown> | undefined;
    if (!metadata) continue;
    if (metadata.field_provenance || metadata.source_ref || metadata.source_file) return true;
  }
  return false;
}

/**
 * Decide whether this batch can become a public project.
 *
 * Refuses only on: unusable slug, missing project name in create mode, absent
 * official-source evidence, or an irreducibly ambiguous identity (a batch that
 * names one slug in the project and a different one in its own fingerprint
 * scope cannot be resolved safely).
 */
export function assessPublishability(batch: ProgressiveBatch): PublishabilityVerdict {
  const slug = batch.project.slug?.trim();
  if (!slug) {
    return {
      ok: false,
      failure: { code: "slug_missing", message: "The source package has no project slug." },
    };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      failure: {
        code: "slug_unusable",
        message: `"${slug}" is not a stable publishable slug (lowercase letters, digits and hyphens, max 80).`,
      },
    };
  }

  // Name: required to create a public record; an update inherits the stored one.
  const name = batch.project.name?.trim() ?? "";
  if (batch.mode === "create" && !name) {
    return {
      ok: false,
      failure: {
        code: "project_name_missing",
        message: "A new project needs a name before it can have a public page.",
      },
    };
  }

  // Warnings are persisted rows, so a value the review queue cannot store is an
  // irreducible technical fact, exactly like an unusable slug — and one the
  // database would otherwise only report mid-publish.
  for (const warning of batch.warnings ?? []) {
    if (!WARNING_ENTITIES.has(warning.entity)) {
      return {
        ok: false,
        failure: {
          code: "warning_entity_unsupported",
          message:
            `Warning "${warning.code}" uses entity "${warning.entity}", which the review queue cannot store. ` +
            `Use one of: ${[...WARNING_ENTITIES].join(", ")}.`,
        },
      };
    }
    if (!WARNING_SEVERITIES.has(warning.severity)) {
      return {
        ok: false,
        failure: {
          code: "warning_severity_unsupported",
          message:
            `Warning "${warning.code}" uses severity "${warning.severity}", which the review queue cannot store. ` +
            `Use one of: ${[...WARNING_SEVERITIES].join(", ")}.`,
        },
      };
    }
  }

  if (!hasOfficialSource(batch)) {
    return {
      ok: false,
      failure: {
        code: "official_source_missing",
        message:
          "No official source evidence is present in the package; direct publication requires at least one.",
      },
    };
  }

  return { ok: true, slug, name };
}
