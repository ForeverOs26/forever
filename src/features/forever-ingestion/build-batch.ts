/**
 * Progressive ingestion — deterministic batch builder.
 *
 * Assembles one `ProgressiveBatch` from whatever exists right now: a minimal
 * manual project payload, and optionally the same extracted price-list JSON
 * the strict planner reads (`ExtractedPriceList` from src/import/types.ts).
 *
 * Responsibilities that deliberately live HERE and not in the SQL boundary:
 *  - non-blocking dependency resolution (link | propose | warn);
 *  - field-level precedence: values rejected by `canReplaceField` are
 *    REMOVED from the write payload and recorded as `field_conflict`
 *    warnings — the presence-aware RPC then guarantees omission can never
 *    overwrite anything;
 *  - the currency doctrine: currency is attached to a price row only when
 *    `decideCurrency` yields a source-verified or deliberately inferred
 *    value; inferred THB records its rule and country reasoning; otherwise
 *    the row carries no currency and one `currency_unresolved` warning is
 *    emitted per batch.
 */

import { createHash } from "node:crypto";

import {
  currencyEvidenceFromFact,
  decideCurrency,
  type CurrencyEvidence,
} from "@/import/currency-policy";
import type { ExtractedPriceList, ExtractedPriceListRow, Fact } from "@/import/types";

import type {
  ProgressiveBatch,
  ProgressiveBuilding,
  ProgressiveMediaItem,
  ProgressivePrice,
  ProgressiveProjectPayload,
  ProgressiveUnit,
  ProgressiveWarning,
} from "./batch-types";
import { assertProgressiveBatchStructure } from "./batch-types";
import {
  resolveDeveloper,
  resolveLocation,
  type DependencyReader,
  type DependencyResolution,
} from "./dependency-resolution";
import { canReplaceField, type FieldProvenance, type FieldProvenanceMap } from "./provenance";

// ---------------------------------------------------------------------------
// Deterministic fingerprint
// ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(",")}}`;
}

/**
 * Client idempotency key: sha256 hex over the key-sorted JSON of the batch
 * WITHOUT `batch_fingerprint`. The server additionally computes its own
 * payload hash (PostgreSQL jsonb serialization) and never trusts this key
 * for content identity.
 */
export function fingerprintBatch(batch: Omit<ProgressiveBatch, "batch_fingerprint">): string {
  return createHash("sha256").update(stableStringify(batch), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Extracted-fact helpers (local equivalents of the strict planner's private
// helpers; the planner itself is strict-lane code and stays untouched)
// ---------------------------------------------------------------------------

function isSourceBackedFact<T>(fact: Fact<T> | undefined): fact is Fact<T> {
  return Boolean(fact?.source_file && fact.value != null && fact.confidence !== "none");
}

function factValue<T>(fact: Fact<T> | undefined): T | null {
  return isSourceBackedFact(fact) ? fact.value : null;
}

function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  const normalized = String(value).replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

// ---------------------------------------------------------------------------
// Precedence filtering
// ---------------------------------------------------------------------------

export interface ExistingFieldState {
  values: Record<string, unknown>;
  fieldProvenance: FieldProvenanceMap;
}

export interface ExistingProjectState {
  project?: ExistingFieldState;
  /** Keyed by building_code. */
  buildings?: Record<string, ExistingFieldState>;
  /** Keyed by unit_code. */
  units?: Record<string, ExistingFieldState>;
  /** Keyed by priceStateKey. */
  prices?: Record<string, ExistingFieldState>;
  /** Keyed by mediaStateKey. */
  media?: Record<string, ExistingFieldState>;
}

export function priceStateKey(price: Pick<ProgressivePrice, "unit_code" | "price_source" | "source_file" | "source_page" | "price_list_date">): string {
  return JSON.stringify([
    price.unit_code,
    price.price_source ?? null,
    price.source_file ?? null,
    price.source_page ?? null,
    price.price_list_date ?? null,
  ]);
}

export function mediaStateKey(media: Pick<ProgressiveMediaItem, "media_type" | "url">): string {
  return JSON.stringify([media.media_type.trim(), media.url.trim()]);
}

interface FilterResult {
  accepted: Record<string, unknown>;
  acceptedProvenance: FieldProvenanceMap;
  conflicts: ProgressiveWarning[];
}

function filterByPrecedence(
  entity: ProgressiveWarning["entity"],
  entityKey: string | undefined,
  incoming: Record<string, unknown>,
  incomingProvenance: FieldProvenanceMap,
  existing: ExistingFieldState | undefined,
): FilterResult {
  const accepted: Record<string, unknown> = {};
  const acceptedProvenance: FieldProvenanceMap = {};
  const conflicts: ProgressiveWarning[] = [];

  for (const [field, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const provenance: FieldProvenance = incomingProvenance[field] ?? { status: "unverified" };
    const currentValue = existing?.values[field];
    const verdict = canReplaceField(
      existing?.fieldProvenance[field],
      provenance,
      currentValue === null || currentValue === undefined,
    );
    if (verdict === "apply") {
      accepted[field] = value;
      if (incomingProvenance[field]) acceptedProvenance[field] = incomingProvenance[field];
      continue;
    }
    conflicts.push({
      entity,
      field,
      code: "field_conflict",
      severity: "warning",
      message: `Rejected lower-precedence value for ${entity} field ${field}.`,
      payload: {
        ...(entityKey ? { key: entityKey } : {}),
        current: currentValue ?? null,
        proposed: value,
        proposed_provenance: provenance,
      },
    });
  }

  return { accepted, acceptedProvenance, conflicts };
}

// ---------------------------------------------------------------------------
// Price-list projection
// ---------------------------------------------------------------------------

function rowUnitCode(row: ExtractedPriceListRow): string | null {
  const value = factValue(row.unit_number);
  return value == null ? null : String(value);
}

interface PriceListProjection {
  buildings: ProgressiveBuilding[];
  units: ProgressiveUnit[];
  prices: ProgressivePrice[];
  warnings: ProgressiveWarning[];
}

function projectPriceList(
  priceList: ExtractedPriceList,
  countryEvidence: CurrencyEvidence | undefined,
  priceListDate: string | undefined,
): PriceListProjection {
  const buildings = new Map<string, ProgressiveBuilding>();
  const units: ProgressiveUnit[] = [];
  const prices: ProgressivePrice[] = [];
  const warnings: ProgressiveWarning[] = [];
  let unresolvedCurrencyRows = 0;

  for (const row of priceList.unit_inventory ?? []) {
    const unitCode = rowUnitCode(row);
    if (!unitCode) continue;
    const buildingCode = factValue(row.building);

    if (buildingCode != null) {
      const code = String(buildingCode).trim();
      if (code && !buildings.has(code)) {
        buildings.set(code, { building_code: code });
      }
    }

    units.push({
      unit_code: unitCode,
      building_code: buildingCode == null ? undefined : String(buildingCode).trim(),
      unit_type: factValue(row.unit_type) ?? undefined,
      bedrooms: parseNumber(factValue(row.bedrooms)) ?? undefined,
      bathrooms: parseNumber(factValue(row.bathrooms)) ?? undefined,
      size_sqm: parseNumber(factValue(row.size_sqm)) ?? undefined,
      floor: parseNumber(factValue(row.floor)) ?? undefined,
      availability_status:
        typeof factValue(row.availability_status) === "string"
          ? String(factValue(row.availability_status)).trim().toLowerCase()
          : undefined,
    });

    const price = parseNumber(factValue(row.price));
    if (price == null) {
      warnings.push({
        entity: "price",
        field: "price",
        code: "price_missing",
        severity: "info",
        message: `Unit ${unitCode} has no source-backed price; the price row was omitted.`,
        payload: { unit_code: unitCode },
      });
      continue;
    }

    const decision = decideCurrency({
      priceEvidence: [currencyEvidenceFromFact(row.currency)],
      countryEvidence,
    });
    if (decision.value == null) unresolvedCurrencyRows += 1;

    prices.push({
      unit_code: unitCode,
      price,
      // NULL when unknown; source-verified or deliberately inferred otherwise.
      currency: decision.value,
      price_source: "developer_price_list",
      source_file: row.price?.source_file ?? row.unit_number?.source_file ?? undefined,
      source_page: row.price?.page_number ?? row.unit_number?.page_number ?? undefined,
      price_list_date: priceListDate,
      metadata: {
        currency_decision: decision as unknown as Record<string, unknown>,
        field_provenance: {
          price: { status: "extracted" },
          ...(decision.status === "inferred_default"
            ? {
                currency: {
                  status: "inferred",
                  reasoning: {
                    rule: decision.inferenceRule,
                    rule_version: decision.inferenceRuleVersion,
                    inferred_from_country: decision.inferredFromCountry,
                  },
                },
              }
            : decision.status === "source_verified"
              ? { currency: { status: "extracted" } }
              : {}),
        },
      },
    });
  }

  if (unresolvedCurrencyRows > 0) {
    warnings.push({
      entity: "price",
      field: "currency",
      code: "currency_unresolved",
      severity: "warning",
      message: `${unresolvedCurrencyRows} price row(s) have no qualifying currency evidence; currency stored as NULL, never defaulted to THB.`,
      payload: { rows: unresolvedCurrencyRows },
    });
  }

  return { buildings: [...buildings.values()], units, prices, warnings };
}

// ---------------------------------------------------------------------------
// Dependency warnings
// ---------------------------------------------------------------------------

function dependencyWarnings(
  entity: "developer" | "location",
  rawName: string | undefined,
  resolution: DependencyResolution,
): ProgressiveWarning[] {
  if (!rawName || resolution.outcome === "skipped" || resolution.outcome === "linked") return [];
  if (resolution.outcome === "unresolved") {
    return [
      {
        entity,
        code: `${entity}_unresolved`,
        severity: "warning",
        message: `No canonical ${entity} matches "${rawName}"; the raw value was preserved for later enrichment.`,
        payload: { raw_name: rawName },
      },
    ];
  }
  if (resolution.outcome === "needs_confirmation") {
    return [
      {
        entity,
        code: `${entity}_match_requires_confirmation`,
        severity: "warning",
        message: `A ${entity} with the same exact name exists but its natural key differs; it was NOT auto-linked.`,
        payload: { raw_name: rawName, candidate_id: resolution.candidateId },
      },
    ];
  }
  return [
    {
      entity,
      code: `${entity}_ambiguous`,
      severity: "warning",
      message: `Multiple canonical ${entity} candidates match "${rawName}"; none was auto-linked.`,
      payload: { raw_name: rawName, candidate_ids: resolution.candidateIds },
    },
  ];
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export interface BuildBatchInput {
  mode: "create" | "enrich";
  project: ProgressiveProjectPayload;
  /** The same extracted shape the strict planner reads. */
  priceList?: ExtractedPriceList | null;
  /** Evidence for the country-based currency inference rule, if any. */
  countryEvidence?: CurrencyEvidence;
  media?: ProgressiveMediaItem[];
  /**
   * Current database state for precedence filtering during enrichment.
   * When provided, values losing to `canReplaceField` are stripped from the
   * payload and become `field_conflict` warnings.
   */
  existing?: ExistingProjectState;
  extraWarnings?: ProgressiveWarning[];
}

export async function buildProgressiveBatch(
  reader: DependencyReader,
  input: BuildBatchInput,
): Promise<ProgressiveBatch> {
  const warnings: ProgressiveWarning[] = [...(input.extraWarnings ?? [])];
  const project: ProgressiveProjectPayload = { ...input.project };

  // 1. Non-blocking dependency resolution (skipped when ids already given).
  if (!project.developer_id && project.developer_name_raw) {
    const resolution = await resolveDeveloper(reader, project.developer_name_raw);
    if (resolution.outcome === "linked") project.developer_id = resolution.id;
    warnings.push(...dependencyWarnings("developer", project.developer_name_raw, resolution));
  }
  if (!project.location_id && project.location_name_raw) {
    const resolution = await resolveLocation(reader, project.location_name_raw);
    if (resolution.outcome === "linked") project.location_id = resolution.id;
    warnings.push(...dependencyWarnings("location", project.location_name_raw, resolution));
    if (!project.location_area) project.location_area = project.location_name_raw;
  }

  // 2. Inventory + prices projected from the extracted price list.
  const priceListDate = input.priceList?.price_list_date?.value ?? undefined;
  const projection = input.priceList
    ? projectPriceList(input.priceList, input.countryEvidence, priceListDate ?? undefined)
    : { buildings: [], units: [], prices: [], warnings: [] };
  warnings.push(...projection.warnings);

  let buildings = projection.buildings;
  let units = projection.units;
  let prices = projection.prices;
  let media = input.media ?? [];

  // 3. Precedence filtering against the current database state (enrich).
  if (input.mode === "enrich" && input.existing) {
    if (project.set) {
      const filtered = filterByPrecedence(
        "project",
        undefined,
        project.set,
        project.field_provenance ?? {},
        input.existing.project,
      );
      project.set = filtered.accepted;
      project.field_provenance = filtered.acceptedProvenance;
      warnings.push(...filtered.conflicts);
    }
    buildings = buildings.map((building) => {
      const { building_code, metadata, ...fields } = building;
      const filtered = filterByPrecedence(
        "building",
        building_code,
        fields as Record<string, unknown>,
        (metadata?.field_provenance as FieldProvenanceMap | undefined) ?? {},
        input.existing?.buildings?.[building_code],
      );
      warnings.push(...filtered.conflicts);
      const nextMetadata = {
        ...(metadata ?? {}),
        field_provenance: filtered.acceptedProvenance,
      };
      return { building_code, metadata: nextMetadata, ...filtered.accepted } as ProgressiveBuilding;
    });
    units = units.map((unit) => {
      const { unit_code, metadata, ...fields } = unit;
      const filtered = filterByPrecedence(
        "unit",
        unit_code,
        fields as Record<string, unknown>,
        (metadata?.field_provenance as FieldProvenanceMap | undefined) ?? {},
        input.existing?.units?.[unit_code],
      );
      warnings.push(...filtered.conflicts);
      const nextMetadata = {
        ...(metadata ?? {}),
        field_provenance: filtered.acceptedProvenance,
      };
      return { unit_code, metadata: nextMetadata, ...filtered.accepted } as ProgressiveUnit;
    });
    prices = prices.flatMap((price) => {
      const { unit_code, metadata, ...fields } = price;
      const filtered = filterByPrecedence(
        "price",
        unit_code,
        fields as Record<string, unknown>,
        (metadata?.field_provenance as FieldProvenanceMap | undefined) ?? {},
        input.existing?.prices?.[priceStateKey(price)],
      );
      warnings.push(...filtered.conflicts);
      // The RPC requires price on every row. If it was rejected, omit the
      // whole update; the conflict warning is still persisted atomically.
      if (!("price" in filtered.accepted)) return [];
      const acceptedPrice = filtered.accepted.price as number;
      return [{
        unit_code,
        ...filtered.accepted,
        price: acceptedPrice,
        metadata: { ...(metadata ?? {}), field_provenance: filtered.acceptedProvenance },
      } as ProgressivePrice];
    });
    media = media.map((item) => {
      const { media_type, url, metadata, ...fields } = item;
      const filtered = filterByPrecedence(
        "media",
        `${media_type}:${url}`,
        fields as Record<string, unknown>,
        (metadata?.field_provenance as FieldProvenanceMap | undefined) ?? {},
        input.existing?.media?.[mediaStateKey(item)],
      );
      warnings.push(...filtered.conflicts);
      return {
        media_type,
        url,
        ...filtered.accepted,
        metadata: { ...(metadata ?? {}), field_provenance: filtered.acceptedProvenance },
      } as ProgressiveMediaItem;
    });
  }

  const body: Omit<ProgressiveBatch, "batch_fingerprint"> = {
    schema_version: "1",
    mode: input.mode,
    project,
    ...(buildings.length ? { buildings } : {}),
    ...(units.length ? { units } : {}),
    ...(prices.length ? { prices } : {}),
    ...(media.length ? { media } : {}),
    ...(warnings.length ? { warnings } : {}),
  };

  const batch = { ...body, batch_fingerprint: fingerprintBatch(body) };
  assertProgressiveBatchStructure(batch);
  return batch;
}
