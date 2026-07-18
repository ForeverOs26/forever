/**
 * Progressive ingestion — the batch contract accepted by the atomic RPC
 * `public.forever_progressive_ingest(batch jsonb)`.
 *
 * One call carries a whole ordinary import (project + buildings + units +
 * prices + media/documents + warnings) of any size, or any later partial
 * enrichment (price-only, media-only, unit-only). The RPC applies it in one
 * transaction; see supabase/migrations/
 * 20260718113000_progressive_ingestion_v1.sql for the authoritative semantics.
 */

import type { FieldProvenanceMap } from "./provenance";

export const PROGRESSIVE_INGEST_FUNCTION = "forever_progressive_ingest" as const;

export type WarningEntity =
  | "project"
  | "listing"
  | "developer"
  | "location"
  | "building"
  | "unit"
  | "price"
  | "media"
  | "document";

export interface ProgressiveWarning {
  entity: WarningEntity;
  field?: string;
  code: string;
  severity: "info" | "warning";
  message: string;
  payload?: Record<string, unknown>;
}

export interface ProgressiveProjectPayload {
  slug: string;
  /** Required for create mode. */
  name?: string;
  developer_id?: string | null;
  location_id?: string | null;
  developer_name_raw?: string;
  location_name_raw?: string;
  location_area?: string;
  project_type?: string;
  address?: string;
  short_description?: string;
  full_description?: string;
  construction_status?: string;
  ownership_type?: string;
  completion_date?: string;
  latitude?: number;
  longitude?: number;
  main_image_url?: string;
  brochure_url?: string;
  starting_price_thb?: number;
  price_range?: string;
  field_provenance?: FieldProvenanceMap;
  /** Enrich only: presence-aware, precedence-filtered column patch. */
  set?: Record<string, unknown>;
  /** Enrich only: the explicit owner publication decision. */
  publish?: boolean;
}

export interface ProgressiveBuilding {
  building_code: string;
  name?: string;
  floors_count?: number;
  units_count?: number;
  metadata?: Record<string, unknown>;
}

export interface ProgressiveUnit {
  unit_code: string;
  building_code?: string;
  unit_type?: string;
  bedrooms?: number;
  bathrooms?: number;
  size_sqm?: number;
  floor?: number;
  availability_status?: string;
  metadata?: Record<string, unknown>;
}

export interface ProgressivePrice {
  unit_code: string;
  price: number;
  /** Omitted/null when no qualifying evidence — never defaulted to THB. */
  currency?: string | null;
  price_source?: string;
  source_file?: string;
  source_page?: number;
  price_list_date?: string;
  /** Carries the full currency_decision for inferred/extracted currencies. */
  metadata?: Record<string, unknown>;
}

export interface ProgressiveMediaItem {
  /** Existing vocabulary: cover|gallery|floor_plan|master_plan|unit_plan|brochure|price_list|payment_plan|video|document */
  media_type: string;
  url: string;
  title?: string;
  sort_order?: number;
  /** Carries field provenance for title/sort_order enrichment. */
  metadata?: Record<string, unknown>;
}

const COLLECTION_KEYS = ["buildings", "units", "prices", "media", "warnings"] as const;

/** Stable runtime boundary shared by the trusted CLI client and tests. */
export function assertProgressiveBatchStructure(value: unknown): asserts value is ProgressiveBatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("forever_progressive_ingest: batch_malformed");
  }
  const batch = value as Record<string, unknown>;
  if (batch.schema_version !== "1") {
    throw new Error("forever_progressive_ingest: schema_version_unsupported");
  }
  for (const key of COLLECTION_KEYS) {
    if (key in batch && !Array.isArray(batch[key])) {
      throw new Error(`forever_progressive_ingest: ${key}_malformed`);
    }
  }
}

export interface ProgressiveBatch {
  schema_version: "1";
  mode: "create" | "enrich";
  /** Client idempotency key: sha256 hex of the canonical batch content. */
  batch_fingerprint: string;
  project: ProgressiveProjectPayload;
  buildings?: ProgressiveBuilding[];
  units?: ProgressiveUnit[];
  prices?: ProgressivePrice[];
  media?: ProgressiveMediaItem[];
  warnings?: ProgressiveWarning[];
}

export interface ProgressiveBatchSummary {
  schema_version: "1";
  mode: "create" | "enrich";
  project_id: string;
  project_slug: string;
  public_status: string;
  counts: {
    buildings: number;
    units: number;
    prices: number;
    media: number;
    warnings: number;
  };
  replayed: boolean;
}
