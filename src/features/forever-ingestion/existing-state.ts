import type { SupabaseClient } from "@supabase/supabase-js";

import {
  mediaStateKey,
  priceStateKey,
  type ExistingProjectState,
} from "./build-batch";
import type { FieldProvenanceMap } from "./provenance";

function provenance(metadata: unknown): FieldProvenanceMap {
  const value = (metadata as Record<string, unknown> | null) ?? {};
  return (value.field_provenance as FieldProvenanceMap | undefined) ?? {};
}

export async function fetchExistingProjectState(
  client: SupabaseClient,
  slug: string,
): Promise<ExistingProjectState | undefined> {
  const { data: project, error } = await client
    .from("projects")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`existing project read failed: ${error.message}`);
  if (!project) return undefined;

  const projectRow = project as Record<string, unknown>;
  const projectId = projectRow.id as string;
  const state: ExistingProjectState = {
    project: {
      values: projectRow,
      fieldProvenance: (projectRow.field_provenance as FieldProvenanceMap | null) ?? {},
    },
    buildings: {},
    units: {},
    prices: {},
    media: {},
  };

  const { data: buildings, error: buildingsError } = await client
    .from("buildings")
    .select("building_code,name,floors_count,units_count,metadata")
    .eq("project_id", projectId);
  if (buildingsError) throw new Error(`existing buildings read failed: ${buildingsError.message}`);
  for (const row of (buildings ?? []) as Array<Record<string, unknown>>) {
    if (!row.building_code) continue;
    state.buildings![String(row.building_code)] = {
      values: row,
      fieldProvenance: provenance(row.metadata),
    };
  }

  const { data: units, error: unitsError } = await client
    .from("units")
    .select("id,unit_code,unit_type,bedrooms,bathrooms,size_sqm,floor,availability_status,metadata")
    .eq("project_id", projectId);
  if (unitsError) throw new Error(`existing units read failed: ${unitsError.message}`);
  const unitCodes = new Map<string, string>();
  for (const row of (units ?? []) as Array<Record<string, unknown>>) {
    if (!row.unit_code) continue;
    unitCodes.set(String(row.id), String(row.unit_code));
    state.units![String(row.unit_code)] = {
      values: row,
      fieldProvenance: provenance(row.metadata),
    };
  }

  if (unitCodes.size) {
    const { data: prices, error: pricesError } = await client
      .from("unit_price_history")
      .select("unit_id,price,currency,price_source,source_file,source_page,price_list_date,metadata")
      .in("unit_id", [...unitCodes.keys()]);
    if (pricesError) throw new Error(`existing prices read failed: ${pricesError.message}`);
    for (const row of (prices ?? []) as Array<Record<string, unknown>>) {
      const unitCode = unitCodes.get(String(row.unit_id));
      if (!unitCode) continue;
      const key = priceStateKey({
        unit_code: unitCode,
        price_source: row.price_source as string | undefined,
        source_file: row.source_file as string | undefined,
        source_page: row.source_page as number | undefined,
        price_list_date: row.price_list_date as string | undefined,
      });
      state.prices![key] = { values: row, fieldProvenance: provenance(row.metadata) };
    }
  }

  const { data: media, error: mediaError } = await client
    .from("project_media")
    .select("media_type,url,title,sort_order,metadata")
    .eq("project_id", projectId);
  if (mediaError) throw new Error(`existing media read failed: ${mediaError.message}`);
  for (const row of (media ?? []) as Array<Record<string, unknown>>) {
    if (!row.media_type || !row.url) continue;
    const key = mediaStateKey({ media_type: String(row.media_type), url: String(row.url) });
    state.media![key] = { values: row, fieldProvenance: provenance(row.metadata) };
  }

  return state;
}
