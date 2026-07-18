/**
 * In-memory behavioral model of `public.forever_progressive_ingest`.
 *
 * This is deliberately NOT a database integration test double for Supabase —
 * it mirrors, statement for statement, the transactional contract of the
 * verified migration (supabase/migrations/
 * 20260718113000_progressive_ingestion_v1.sql): envelope validation,
 * idempotency with a server-computed payload hash, presence-aware updates,
 * project-scoped child resolution, and all-or-nothing application. Tests
 * built on it are labelled in-memory behavioral tests; the SQL text itself
 * is verified by the static migration-contract tests.
 */

import type {
  ProgressiveBatch,
  ProgressiveBatchSummary,
} from "../batch-types";
import { fingerprintBatch } from "../build-batch";
import type { ProgressiveIngestClient } from "../ingest-client";

export interface FakeProjectRow {
  id: string;
  slug: string;
  name: string;
  developer_id: string | null;
  location_id: string | null;
  developer_name_raw: string | null;
  location_name_raw: string | null;
  location_area: string | null;
  public_status: string;
  is_active: boolean;
  forever_verified: boolean;
  field_provenance: Record<string, unknown>;
  [key: string]: unknown;
}

export interface FakeBuildingRow {
  id: string;
  project_id: string;
  building_code: string;
  name: string;
  floors_count: number | null;
  units_count: number | null;
  metadata: Record<string, unknown>;
}

export interface FakeUnitRow {
  id: string;
  project_id: string;
  building_id: string | null;
  unit_code: string;
  unit_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  size_sqm: number | null;
  floor: number | null;
  availability_status: string;
  metadata: Record<string, unknown>;
}

export interface FakePriceRow {
  id: string;
  unit_id: string;
  price: number;
  currency: string | null;
  price_source: string | null;
  source_file: string | null;
  source_page: number | null;
  price_list_date: string | null;
  metadata: Record<string, unknown>;
}

export interface FakeMediaRow {
  id: string;
  project_id: string;
  media_type: string;
  title: string | null;
  url: string;
  sort_order: number;
  metadata: Record<string, unknown>;
}

export interface FakeWarningRow {
  id: string;
  project_id: string;
  entity: string;
  field: string | null;
  code: string;
  severity: string;
  message: string;
  payload: Record<string, unknown>;
}

export interface FakeBatchRow {
  project_id: string;
  batch_fingerprint: string;
  payload_hash: string;
  mode: string;
  summary: ProgressiveBatchSummary;
}

export interface FakeStore {
  projects: FakeProjectRow[];
  buildings: FakeBuildingRow[];
  units: FakeUnitRow[];
  prices: FakePriceRow[];
  media: FakeMediaRow[];
  warnings: FakeWarningRow[];
  batches: FakeBatchRow[];
}

export function emptyStore(): FakeStore {
  return { projects: [], buildings: [], units: [], prices: [], media: [], warnings: [], batches: [] };
}

function present(item: Record<string, unknown> | undefined, key: string): boolean {
  return Boolean(item && key in item && item[key] !== null && item[key] !== undefined);
}

function trimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean.length ? clean : null;
}

function mergeMetadata(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const currentProvenance = (current.field_provenance as Record<string, unknown> | undefined) ?? {};
  const incomingProvenance = (incoming.field_provenance as Record<string, unknown> | undefined) ?? {};
  return {
    ...current,
    ...incoming,
    field_provenance: { ...currentProvenance, ...incomingProvenance },
  };
}

export class FakeIngestExecutor implements ProgressiveIngestClient {
  store: FakeStore = emptyStore();
  private sequence = 0;
  /** Inject a technical failure while writing this unit code. */
  failOnUnitCode: string | null = null;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  /** Models the server-side payload hash over the batch minus its key. */
  static payloadHash(batch: ProgressiveBatch): string {
    const { batch_fingerprint, ...body } = batch;
    void batch_fingerprint;
    return fingerprintBatch(body as Omit<ProgressiveBatch, "batch_fingerprint">);
  }

  /** Rows visible to the anonymous public under the migration's RLS. */
  publicProjects(): FakeProjectRow[] {
    return this.store.projects.filter(
      (row) => row.is_active && row.public_status === "published",
    );
  }

  async ingest(batch: ProgressiveBatch): Promise<ProgressiveBatchSummary> {
    // One transaction: apply against a working copy, commit only on success.
    const working = structuredClone(this.store);
    const summary = this.apply(working, structuredClone(batch));
    this.store = working;
    return summary;
  }

  private apply(store: FakeStore, batch: ProgressiveBatch): ProgressiveBatchSummary {
    if (!batch || typeof batch !== "object") {
      throw new Error("forever_progressive_ingest: batch_malformed");
    }
    if (batch.schema_version !== "1") {
      throw new Error("forever_progressive_ingest: schema_version_unsupported");
    }
    for (const key of ["buildings", "units", "prices", "media", "warnings"] as const) {
      if (key in batch && !Array.isArray(batch[key])) {
        throw new Error(`forever_progressive_ingest: ${key}_malformed`);
      }
    }
    const mode = batch.mode;
    if (mode !== "create" && mode !== "enrich") {
      throw new Error("forever_progressive_ingest: mode_invalid");
    }
    if (!batch.project || typeof batch.project !== "object") {
      throw new Error("forever_progressive_ingest: project_missing");
    }
    const slug = trimmed(batch.project.slug);
    if (!slug) throw new Error("forever_progressive_ingest: project_slug_required");
    if (!/^[0-9a-f]{64}$/.test(batch.batch_fingerprint ?? "")) {
      throw new Error("forever_progressive_ingest: batch_fingerprint_invalid");
    }

    const payloadHash = FakeIngestExecutor.payloadHash(batch);
    let project = store.projects.find((row) => row.slug === slug);

    if (project) {
      const stored = store.batches.find(
        (row) => row.project_id === project!.id && row.batch_fingerprint === batch.batch_fingerprint,
      );
      if (stored) {
        if (stored.payload_hash === payloadHash) {
          return { ...stored.summary, replayed: true };
        }
        throw new Error("forever_progressive_ingest: fingerprint_payload_mismatch");
      }
      if (mode === "create") {
        throw new Error("forever_progressive_ingest: project_slug_exists");
      }
    } else if (mode === "enrich") {
      throw new Error("forever_progressive_ingest: project_not_found");
    }

    let warningsCount = 0;
    const pushWarning = (row: Omit<FakeWarningRow, "id">) => {
      store.warnings.push({ id: this.nextId("warn"), ...row });
      warningsCount += 1;
    };

    if (mode === "create") {
      const name = trimmed(batch.project.name);
      if (!name) throw new Error("forever_progressive_ingest: project_name_required");
      project = {
        id: this.nextId("proj"),
        slug,
        name,
        developer_id: batch.project.developer_id ?? null,
        location_id: batch.project.location_id ?? null,
        developer_name_raw: batch.project.developer_name_raw ?? null,
        location_name_raw: batch.project.location_name_raw ?? null,
        location_area: batch.project.location_area ?? null,
        project_type: batch.project.project_type ?? null,
        address: batch.project.address ?? null,
        short_description: batch.project.short_description ?? null,
        full_description: batch.project.full_description ?? null,
        construction_status: batch.project.construction_status ?? null,
        ownership_type: batch.project.ownership_type ?? null,
        completion_date: batch.project.completion_date ?? null,
        latitude: batch.project.latitude ?? null,
        longitude: batch.project.longitude ?? null,
        main_image_url: batch.project.main_image_url ?? null,
        brochure_url: batch.project.brochure_url ?? null,
        starting_price_thb: batch.project.starting_price_thb ?? null,
        price_range: batch.project.price_range ?? null,
        public_status: "draft",
        is_active: true,
        forever_verified: false,
        field_provenance: (batch.project.field_provenance ?? {}) as Record<string, unknown>,
      };
      store.projects.push(project);
    } else {
      const set = (batch.project.set ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(set)) {
        if (value === null || value === undefined) continue;
        if (key === "name" && !trimmed(value)) continue;
        project![key] = value;
      }
      if (batch.project.publish === true) project!.public_status = "published";
      if (batch.project.publish === false) project!.public_status = "draft";
      project!.field_provenance = {
        ...project!.field_provenance,
        ...((batch.project.field_provenance ?? {}) as Record<string, unknown>),
      };
    }

    const projectId = project!.id;
    const batchBuildingIds = new Map<string, string>();
    const batchUnitIds = new Map<string, string>();

    for (const item of batch.buildings ?? []) {
      const code = trimmed(item.building_code);
      if (!code) throw new Error("forever_progressive_ingest: building_code_required");
      let building = store.buildings.find(
        (row) => row.project_id === projectId && row.building_code === code,
      );
      if (!building) {
        building = {
          id: this.nextId("bld"),
          project_id: projectId,
          building_code: code,
          name: trimmed(item.name) ?? `Building ${code}`,
          floors_count: item.floors_count ?? null,
          units_count: item.units_count ?? null,
          metadata: (item.metadata ?? {}) as Record<string, unknown>,
        };
        store.buildings.push(building);
      } else {
        const record = item as unknown as Record<string, unknown>;
        if (present(record, "name") && trimmed(record.name)) building.name = trimmed(record.name)!;
        if (present(record, "floors_count")) building.floors_count = item.floors_count!;
        if (present(record, "units_count")) building.units_count = item.units_count!;
        building.metadata = mergeMetadata(building.metadata, item.metadata ?? {});
      }
      batchBuildingIds.set(code, building.id);
    }

    for (const item of batch.units ?? []) {
      const code = trimmed(item.unit_code);
      if (!code) throw new Error("forever_progressive_ingest: unit_code_required");
      if (this.failOnUnitCode === code) {
        throw new Error("forever_progressive_ingest: injected_failure");
      }

      let buildingId: string | null = null;
      if (item.building_code != null) {
        buildingId = batchBuildingIds.get(item.building_code) ?? null;
        if (!buildingId) {
          buildingId =
            store.buildings.find(
              (row) =>
                row.project_id === projectId &&
                row.building_code === item.building_code!.trim(),
            )?.id ?? null;
        }
        if (!buildingId) {
          pushWarning({
            project_id: projectId,
            entity: "unit",
            field: "building_id",
            code: "building_unresolved",
            severity: "warning",
            message:
              "Unit references a building that exists neither in this batch nor in this project.",
            payload: { unit_code: code, building_code: item.building_code },
          });
        }
      }

      let unit = store.units.find(
        (row) => row.project_id === projectId && row.unit_code === code,
      );
      if (!unit) {
        unit = {
          id: this.nextId("unit"),
          project_id: projectId,
          building_id: buildingId,
          unit_code: code,
          unit_type: item.unit_type ?? null,
          bedrooms: item.bedrooms ?? null,
          bathrooms: item.bathrooms ?? null,
          size_sqm: item.size_sqm ?? null,
          floor: item.floor ?? null,
          availability_status: trimmed(item.availability_status) ?? "available",
          metadata: (item.metadata ?? {}) as Record<string, unknown>,
        };
        store.units.push(unit);
      } else {
        const record = item as unknown as Record<string, unknown>;
        if (buildingId) unit.building_id = buildingId;
        if (present(record, "unit_type")) unit.unit_type = item.unit_type!;
        if (present(record, "bedrooms")) unit.bedrooms = item.bedrooms!;
        if (present(record, "bathrooms")) unit.bathrooms = item.bathrooms!;
        if (present(record, "size_sqm")) unit.size_sqm = item.size_sqm!;
        if (present(record, "floor")) unit.floor = item.floor!;
        if (present(record, "availability_status") && trimmed(record.availability_status)) {
          unit.availability_status = item.availability_status!;
        }
        unit.metadata = mergeMetadata(unit.metadata, item.metadata ?? {});
      }
      batchUnitIds.set(code, unit.id);
    }

    for (const item of batch.prices ?? []) {
      const code = trimmed(item.unit_code);
      let unitId = code ? batchUnitIds.get(code) ?? null : null;
      if (!unitId && code) {
        unitId =
          store.units.find((row) => row.project_id === projectId && row.unit_code === code)?.id ??
          null;
      }
      if (!unitId) {
        throw new Error(`forever_progressive_ingest: price_unit_unknown (${code ?? "?"})`);
      }
      if (item.price === null || item.price === undefined) {
        throw new Error(`forever_progressive_ingest: price_value_required (${code})`);
      }
      const record = item as unknown as Record<string, unknown>;
      const existing = store.prices.find(
        (row) =>
          row.unit_id === unitId &&
          row.price_source === (item.price_source ?? null) &&
          row.source_file === (item.source_file ?? null) &&
          row.source_page === (item.source_page ?? null) &&
          row.price_list_date === (item.price_list_date ?? null),
      );
      if (!existing) {
        store.prices.push({
          id: this.nextId("price"),
          unit_id: unitId,
          price: item.price,
          currency: trimmed(item.currency) ?? null,
          price_source: item.price_source ?? null,
          source_file: item.source_file ?? null,
          source_page: item.source_page ?? null,
          price_list_date: item.price_list_date ?? null,
          metadata: (item.metadata ?? {}) as Record<string, unknown>,
        });
      } else {
        existing.price = item.price;
        if (present(record, "currency") && trimmed(record.currency)) {
          existing.currency = trimmed(record.currency);
        }
        existing.metadata = mergeMetadata(existing.metadata, item.metadata ?? {});
      }
    }

    for (const item of batch.media ?? []) {
      const url = trimmed(item.url);
      const mediaType = trimmed(item.media_type);
      if (!url || !mediaType) {
        throw new Error("forever_progressive_ingest: media_item_invalid");
      }
      const record = item as unknown as Record<string, unknown>;
      const existing = store.media.find(
        (row) => row.project_id === projectId && row.media_type === mediaType && row.url === url,
      );
      if (!existing) {
        store.media.push({
          id: this.nextId("media"),
          project_id: projectId,
          media_type: mediaType,
          title: item.title ?? null,
          url,
          sort_order: item.sort_order ?? 0,
          metadata: item.metadata ?? {},
        });
      } else {
        if (present(record, "title")) existing.title = item.title!;
        if (present(record, "sort_order")) existing.sort_order = item.sort_order!;
        existing.metadata = mergeMetadata(existing.metadata, item.metadata ?? {});
      }
    }

    for (const item of batch.warnings ?? []) {
      pushWarning({
        project_id: projectId,
        entity: item.entity,
        field: item.field ?? null,
        code: item.code,
        severity: item.severity ?? "warning",
        message: item.message,
        payload: (item.payload ?? {}) as Record<string, unknown>,
      });
    }

    const summary: ProgressiveBatchSummary = {
      schema_version: "1",
      mode,
      project_id: projectId,
      project_slug: slug,
      public_status: project!.public_status,
      counts: {
        buildings: (batch.buildings ?? []).length,
        units: (batch.units ?? []).length,
        prices: (batch.prices ?? []).length,
        media: (batch.media ?? []).length,
        warnings: warningsCount,
      },
      replayed: false,
    };
    store.batches.push({
      project_id: projectId,
      batch_fingerprint: batch.batch_fingerprint,
      payload_hash: payloadHash,
      mode,
      summary,
    });
    return summary;
  }
}
