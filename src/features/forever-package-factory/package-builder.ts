/**
 * Package Factory — the Publish-Package Builder.
 *
 * Assembles the `ProgressiveBatch` and the physical directory that the existing
 * Direct Publish lane already accepts. Nothing here is a new publishing system:
 * the output is exactly `progressive/payload.json` + `source-manifest.json` +
 * media files, read back by `forever-direct-publish/source-package.ts`.
 *
 * Three properties the builder is responsible for:
 *   - determinism: the same sources produce the same bytes and the same
 *     `batch_fingerprint`, so an identical replay writes no new rows;
 *   - privacy: no local path, no Drive id, no Telegram invite token and no
 *     credential ever reaches the payload or the manifest;
 *   - honesty: a field with no evidence is absent, and a rejected price row is
 *     absent, rather than filled with a plausible value.
 */

import type {
  ProgressiveBatch,
  ProgressiveBuilding,
  ProgressiveMediaItem,
  ProgressivePrice,
  ProgressiveUnit,
  ProgressiveWarning,
} from "../forever-ingestion/batch-types";
import { fingerprintBatch } from "../forever-ingestion/build-batch";

import { buildFieldProvenance } from "./facts";
import type { IdentityResolution } from "./identity";
import type { SelectedMedia } from "./media-selection";
import { normalizeStatus, type ReconciledAvailability } from "./precedence";
import type { ParsedUnitRow } from "./types";

/** Public-safe provenance record written next to the payload. */
export interface SourceManifest {
  schema_version: "forever-package-factory.v1";
  slug: string;
  operation: "create" | "update";
  /** Public-safe references only — basenames, channel usernames, host names. */
  sources: Array<{
    ref: string;
    kind: string;
    authority: string;
    sha256?: string;
    effective_date?: string | null;
    revision?: string | null;
    published_at?: string | null;
    repost_of?: string | null;
  }>;
  price_source: {
    ref: string;
    effective_date: string | null;
    revision: string | null;
    layout_id: string;
    validation_method: string;
    accepted_rows: number;
    rejected_rows: number;
    unresolved_rows: number;
  } | null;
  media: Array<{ file: string; media_type: string; sha256: string; source_ref: string }>;
  batch_fingerprint: string;
}

export interface BuildPackageInput {
  identity: IdentityResolution;
  /** Accepted, validated price rows. May be empty — that is not a failure. */
  units: readonly ParsedUnitRow[];
  availability: readonly ReconciledAvailability[];
  media: readonly SelectedMedia[];
  warnings: readonly ProgressiveWarning[];
  /** Currency evidenced by the price document. Null when none was evidenced. */
  currency: string | null;
  priceSource: {
    ref: string;
    effectiveDate: string | null;
    revision: string | null;
    layoutId: string;
    validationMethod: string;
    acceptedRows: number;
    rejectedRows: number;
    unresolvedRows: number;
  } | null;
  manifestSources: SourceManifest["sources"];
}

export interface BuiltPackage {
  batch: ProgressiveBatch;
  manifest: SourceManifest;
  /** Package-relative path → bytes. Written verbatim by the CLI. */
  files: Map<string, Buffer>;
}

/** Buildings implied by the unit rows. Never invented beyond what rows state. */
export function buildingsFromUnits(units: readonly ParsedUnitRow[]): ProgressiveBuilding[] {
  const codes = new Map<string, { floors: Set<number>; units: number }>();
  for (const unit of units) {
    if (!unit.building) continue;
    const entry = codes.get(unit.building) ?? { floors: new Set<number>(), units: 0 };
    if (unit.floor !== null) entry.floors.add(unit.floor);
    entry.units += 1;
    codes.set(unit.building, entry);
  }
  return [...codes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([building_code, entry]) => ({
      building_code,
      // Counts are observations of the supplied schedule, not a claim about the
      // finished building: a schedule listing only available units understates
      // both, so they are recorded and the projection treats them as such.
      floors_count: entry.floors.size > 0 ? Math.max(...entry.floors) : undefined,
      units_count: entry.units,
    }));
}

function unitRow(
  unit: ParsedUnitRow,
  status: string,
  sourceRef: string,
  sourceDate: string | null,
): ProgressiveUnit {
  return {
    unit_code: unit.unitCode,
    ...(unit.building ? { building_code: unit.building } : {}),
    ...(unit.unitType ? { unit_type: unit.unitType } : {}),
    ...(unit.sizeSqm !== null ? { size_sqm: unit.sizeSqm } : {}),
    ...(unit.floor !== null ? { floor: unit.floor } : {}),
    availability_status: status,
    metadata: {
      field_provenance: buildFieldProvenance({
        fields: ["availability_status", ...(unit.sizeSqm !== null ? ["size_sqm"] : [])],
        sourceRef,
        sourceType: "developer_official_document",
        sourceDate,
      }),
      ...(unit.typeCode ? { type_code: unit.typeCode } : {}),
      ...(unit.landAreaSqm !== null ? { land_area_sqm: unit.landAreaSqm } : {}),
    },
  };
}

function priceRow(
  unit: ParsedUnitRow,
  currency: string | null,
  source: NonNullable<BuildPackageInput["priceSource"]>,
): ProgressivePrice | null {
  if (unit.totalPrice === null || !(unit.totalPrice > 0)) return null;
  return {
    unit_code: unit.unitCode,
    price: unit.totalPrice,
    // Never defaulted to THB: absent evidence means the row carries no currency.
    ...(currency ? { currency } : {}),
    price_source: "developer_official_price_list",
    source_file: source.ref,
    source_page: unit.page,
    ...(source.effectiveDate ? { price_list_date: source.effectiveDate } : {}),
    metadata: {
      ...(unit.pricePerSqm !== null ? { price_per_sqm: unit.pricePerSqm } : {}),
      layout_id: source.layoutId,
      validation_method: source.validationMethod,
      ...(source.revision ? { source_revision: source.revision } : {}),
    },
  };
}

/**
 * Build the batch and the physical file set.
 *
 * `mode` follows the resolved identity, but Direct Publish re-decides
 * create-vs-enrich against the live database, so a package authored as `create`
 * that turns out to exist still updates rather than failing.
 */
export function buildPackage(input: BuildPackageInput): BuiltPackage {
  const { identity } = input;
  if (!identity.slug) throw new Error("buildPackage requires a resolved slug");

  const statusByUnit = new Map(
    input.availability.map((entry) => [entry.unitCode.toUpperCase(), entry.status]),
  );

  const sourceRef = input.priceSource?.ref ?? input.manifestSources[0]?.ref ?? "official-source";
  const sourceDate = input.priceSource?.effectiveDate ?? null;

  const units: ProgressiveUnit[] = input.units.map((unit) =>
    unitRow(
      unit,
      statusByUnit.get(unit.unitCode.toUpperCase()) ??
        normalizeStatus(unit.availabilityStatus ?? "available"),
      sourceRef,
      sourceDate,
    ),
  );

  // A SOLD announcement may name a unit the current schedule no longer lists.
  // It is still a true statement about that unit, so it becomes a unit row with
  // a status and no price rather than being dropped.
  const known = new Set(units.map((unit) => unit.unit_code.toUpperCase()));
  for (const entry of input.availability) {
    if (known.has(entry.unitCode.toUpperCase())) continue;
    units.push({
      unit_code: entry.unitCode,
      availability_status: entry.status,
      metadata: {
        field_provenance: buildFieldProvenance({
          fields: ["availability_status"],
          sourceRef: entry.sourceRef,
          sourceType: "developer_official_update",
          sourceDate: entry.effectiveDate,
        }),
      },
    });
  }
  units.sort((left, right) => left.unit_code.localeCompare(right.unit_code));

  const prices: ProgressivePrice[] = input.priceSource
    ? input.units
        .map((unit) => priceRow(unit, input.currency, input.priceSource!))
        .filter((row): row is ProgressivePrice => row !== null)
        .sort((left, right) => left.unit_code.localeCompare(right.unit_code))
    : [];

  const buildings = buildingsFromUnits(input.units);

  // Media travels as FILES, not as payload rows. The publish lane sanitizes
  // each file, uploads the derivative and derives the public URL itself; a row
  // declared here would either carry no URL or duplicate the one it creates.
  const media: ProgressiveMediaItem[] = [];
  const files = new Map<string, Buffer>();
  for (const item of input.media) files.set(item.filename, item.bytes);

  const provenanceFields = [
    "name",
    ...(identity.developer ? ["developer_name_raw"] : []),
    ...(identity.area ? ["location_area"] : []),
  ];
  const field_provenance = buildFieldProvenance({
    fields: provenanceFields,
    sourceRef,
    sourceType: "developer_official_document",
    sourceDate,
  });

  const projectColumns: Record<string, unknown> = {
    name: identity.name ?? undefined,
    ...(identity.developer ? { developer_name_raw: identity.developer } : {}),
    ...(identity.area ? { location_area: identity.area } : {}),
  };
  for (const key of Object.keys(projectColumns)) {
    if (projectColumns[key] === undefined) delete projectColumns[key];
  }

  const mode: "create" | "enrich" = identity.operation === "update" ? "enrich" : "create";
  const project =
    mode === "enrich"
      ? { slug: identity.slug, set: projectColumns, publish: true, field_provenance }
      : { slug: identity.slug, ...projectColumns, field_provenance };

  const body = {
    schema_version: "1" as const,
    mode,
    project: project as ProgressiveBatch["project"],
    ...(buildings.length ? { buildings } : {}),
    ...(units.length ? { units } : {}),
    ...(prices.length ? { prices } : {}),
    ...(media.length ? { media } : {}),
    ...(input.warnings.length ? { warnings: [...input.warnings] } : {}),
  };

  const batch: ProgressiveBatch = { ...body, batch_fingerprint: fingerprintBatch(body) };

  const manifest: SourceManifest = {
    schema_version: "forever-package-factory.v1",
    slug: identity.slug,
    operation: identity.operation === "update" ? "update" : "create",
    sources: input.manifestSources,
    price_source: input.priceSource
      ? {
          ref: input.priceSource.ref,
          effective_date: input.priceSource.effectiveDate,
          revision: input.priceSource.revision,
          layout_id: input.priceSource.layoutId,
          validation_method: input.priceSource.validationMethod,
          accepted_rows: input.priceSource.acceptedRows,
          rejected_rows: input.priceSource.rejectedRows,
          unresolved_rows: input.priceSource.unresolvedRows,
        }
      : null,
    media: input.media.map((item) => ({
      file: item.filename,
      media_type: item.mediaType,
      sha256: item.sha256,
      source_ref: item.sourceRef,
    })),
    batch_fingerprint: batch.batch_fingerprint,
  };

  files.set("progressive/payload.json", Buffer.from(`${JSON.stringify(batch, null, 2)}\n`, "utf8"));
  files.set("source-manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"));

  return { batch, manifest, files };
}
