import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ForeverManifest } from "./manifest";

type DatabaseClient = SupabaseClient<any, "public", any>;
type JsonObject = Record<string, unknown>;

export interface DeveloperRecord {
  id: string;
  name: string;
  slug?: string;
}

export interface LocationRecord {
  id: string;
  slug?: string;
  area_name?: string;
}

export interface ProjectRecord {
  id: string;
  slug: string;
  name: string;
}

export interface BuildingInput {
  buildingCode: string;
  name: string;
  unitsCount?: number;
  floorsCount?: number;
  metadata?: JsonObject;
}

export interface UnitInput {
  unitNumber: string;
  buildingCode?: string;
  sourceTypeCode?: string;
  unitType?: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sizeSqm?: number | null;
  floor?: number | null;
  price?: number | null;
  currency?: string;
  pricePerSqm?: number | null;
  availabilityStatus?: string;
  sourceFile?: string;
  sourcePage?: number | null;
  sourceRow?: number | null;
  priceListDate?: string;
  raw?: unknown;
}

export interface PriceHistoryInput extends UnitInput {
  unitId: string;
}

export interface DatabaseLayer {
  client: DatabaseClient;
  getDeveloper(nameOrSlug: string): Promise<DeveloperRecord | null>;
  getLocation(location: string): Promise<LocationRecord | null>;
  getProject(slug: string): Promise<ProjectRecord | null>;
  upsertDeveloper(manifest: ForeverManifest): Promise<DeveloperRecord>;
  upsertLocation(manifest: ForeverManifest): Promise<LocationRecord>;
  upsertProject(
    manifest: ForeverManifest,
    developer: DeveloperRecord,
    location: LocationRecord,
    projectFacts?: JsonObject,
  ): Promise<ProjectRecord>;
  upsertBuildings(project: ProjectRecord, buildings: BuildingInput[]): Promise<Map<string, string>>;
  upsertUnits(project: ProjectRecord, buildingIds: Map<string, string>, units: UnitInput[]): Promise<Map<string, string>>;
  upsertPriceHistory(unitIds: Map<string, string>, units: UnitInput[]): Promise<number>;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function requireEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    if (isNewSupabaseApiKey(supabaseKey) && headers.get("Authorization") === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function createImportClient() {
  const url = requireEnvironment("SUPABASE_URL");
  const serviceRoleKey = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");

  return createClient<any, "public", any>(url, serviceRoleKey, {
    global: {
      fetch: createSupabaseFetch(serviceRoleKey),
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function unwrap<T>(data: T | null, error: { message: string } | null) {
  if (error) throw new Error(error.message);
  return data;
}

async function maybeSingle<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const { data, error } = await query;
  return unwrap(data, error);
}

async function execute<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const { data, error } = await query;
  return unwrap(data, error);
}

export function createDatabaseLayer(client: DatabaseClient = createImportClient()): DatabaseLayer {
  return {
    client,

    async getDeveloper(nameOrSlug) {
      const slug = slugify(nameOrSlug);
      return maybeSingle<DeveloperRecord>(
        client
          .from("developers")
          .select("id,name,slug")
          .or(`slug.eq.${slug},name.eq.${nameOrSlug}`)
          .maybeSingle(),
      );
    },

    async getLocation(location) {
      const slug = slugify(location);
      return maybeSingle<LocationRecord>(
        client
          .from("locations")
          .select("id,slug,area_name")
          .or(`slug.eq.${slug},area_name.eq.${location}`)
          .maybeSingle(),
      );
    },

    async getProject(slug) {
      return maybeSingle<ProjectRecord>(
        client.from("projects").select("id,slug,name").eq("slug", slug).maybeSingle(),
      );
    },

    async upsertDeveloper(manifest) {
      const slug = slugify(manifest.developer);
      const payload = {
        slug,
        name: manifest.developer,
        legal_name: manifest.developer,
        country: manifest.country,
        headquarters_location: `${manifest.province}, ${manifest.country}`,
        verification_status: "source_imported",
        updated_at: new Date().toISOString(),
      };

      const data = await execute<DeveloperRecord[]>(
        client.from("developers").upsert(payload, { onConflict: "slug" }).select("id,name,slug"),
      );

      if (!data?.[0]) throw new Error(`Developer upsert failed: ${manifest.developer}`);
      return data[0];
    },

    async upsertLocation(manifest) {
      const slug = slugify(manifest.location);
      const payload = {
        slug,
        area_name: manifest.location,
        country: manifest.country,
        province: manifest.province,
        updated_at: new Date().toISOString(),
      };

      const data = await execute<LocationRecord[]>(
        client.from("locations").upsert(payload, { onConflict: "slug" }).select("id,slug,area_name"),
      );

      if (!data?.[0]) throw new Error(`Location upsert failed: ${manifest.location}`);
      return data[0];
    },

    async upsertProject(manifest, developer, location, projectFacts = {}) {
      void projectFacts;
      const payload = {
        slug: manifest.project_slug,
        name: manifest.project_name,
        developer_id: developer.id,
        location_id: location.id,
        project_code: manifest.project_slug.toUpperCase(),
        project_type: manifest.project_type,
        location_area: manifest.location,
        address: `${manifest.location}, ${manifest.province}, ${manifest.country}`,
        short_description: `${manifest.project_name} imported from Forever source materials.`,
        full_description: `${manifest.project_name} imported from Forever source materials.`,
        is_active: true,
        public_status: "published",
        sales_status: "Available",
        last_data_review_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const data = await execute<ProjectRecord[]>(
        client.from("projects").upsert(payload, { onConflict: "slug" }).select("id,slug,name"),
      );

      if (!data?.[0]) throw new Error(`Project upsert failed: ${manifest.project_slug}`);
      return data[0];
    },

    async upsertBuildings(project, buildings) {
      const ids = new Map<string, string>();

      for (const building of buildings) {
        const payload = {
          project_id: project.id,
          name: building.name,
          building_code: building.buildingCode,
          building_type: "residential",
          floors_count: building.floorsCount ?? null,
          units_count: building.unitsCount ?? null,
          metadata: building.metadata ?? {},
          updated_at: new Date().toISOString(),
        };

        const data = await execute<Array<{ id: string; building_code: string }>>(
          client
            .from("buildings")
            .upsert(payload, { onConflict: "project_id,building_code" })
            .select("id,building_code"),
        );

        if (data?.[0]) ids.set(data[0].building_code, data[0].id);
      }

      return ids;
    },

    async upsertUnits(project, buildingIds, units) {
      const ids = new Map<string, string>();

      for (const unit of units) {
        const existing = await maybeSingle<{ id: string }>(
          client
            .from("units")
            .select("id")
            .eq("project_id", project.id)
            .eq("unit_code", unit.unitNumber)
            .maybeSingle(),
        );

        const payload = {
          project_id: project.id,
          building_id: unit.buildingCode ? buildingIds.get(unit.buildingCode) : null,
          unit_code: unit.unitNumber,
          unit_type: unit.unitType ?? null,
          bedrooms: unit.bedrooms ?? null,
          bathrooms: unit.bathrooms ?? null,
          size_sqm: unit.sizeSqm ?? null,
          floor: unit.floor ?? null,
          base_price_thb: unit.currency === "THB" ? unit.price ?? null : null,
          price_per_sqm: unit.pricePerSqm ?? null,
          availability_status: unit.availabilityStatus ?? "available",
          unit_status: unit.availabilityStatus ?? "available",
          metadata: {
            source_type_code: unit.sourceTypeCode,
            currency: unit.currency,
            source_file: unit.sourceFile,
            source_page: unit.sourcePage,
            source_row: unit.sourceRow,
            price_list_date: unit.priceListDate,
            raw: unit.raw,
          },
          updated_at: new Date().toISOString(),
        };

        if (existing?.id) {
          await execute(client.from("units").update(payload).eq("id", existing.id).select("id"));
          ids.set(unit.unitNumber, existing.id);
          continue;
        }

        const data = await execute<Array<{ id: string }>>(
          client.from("units").insert(payload).select("id"),
        );
        if (data?.[0]) ids.set(unit.unitNumber, data[0].id);
      }

      return ids;
    },

    async upsertPriceHistory(unitIds, units) {
      let count = 0;

      for (const unit of units) {
        const unitId = unitIds.get(unit.unitNumber);
        if (!unitId || unit.price == null) continue;

        const payload = {
          unit_id: unitId,
          price: unit.price,
          currency: unit.currency ?? "THB",
          price_source: "developer_price_list",
          source_file: unit.sourceFile ?? null,
          source_page: unit.sourcePage ?? null,
          price_list_date: unit.priceListDate ?? null,
          recorded_at: new Date().toISOString(),
          metadata: {
            source_type_code: unit.sourceTypeCode,
            unit_number: unit.unitNumber,
            building_code: unit.buildingCode,
            floor: unit.floor,
            unit_type: unit.unitType,
            bedrooms: unit.bedrooms,
            size_sqm: unit.sizeSqm,
            price_per_sqm: unit.pricePerSqm,
            availability_status: unit.availabilityStatus,
            source_row: unit.sourceRow,
            raw: unit.raw,
          },
          updated_at: new Date().toISOString(),
        };

        const existing = await maybeSingle<{ id: string }>(
          client
            .from("unit_price_history")
            .select("id")
            .eq("unit_id", unitId)
            .eq("price_source", payload.price_source)
            .eq("source_file", payload.source_file)
            .eq("source_page", payload.source_page)
            .eq("price_list_date", payload.price_list_date)
            .maybeSingle(),
        );

        if (existing?.id) {
          await execute(client.from("unit_price_history").update(payload).eq("id", existing.id).select("id"));
        } else {
          await execute(client.from("unit_price_history").insert(payload).select("id"));
        }

        count += 1;
      }

      return count;
    },
  };
}
