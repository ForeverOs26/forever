import type { Json } from "@/integrations/supabase/types";
import type { BuildingInput, UnitInput } from "./database";
import type { ForeverManifest } from "./manifest";
import type { ProjectValidationReport } from "./validator";
import type {
  ExtractedDatasets,
  ExtractedPriceList,
  Fact,
  ImportMode,
  ImportOperation,
  ImportPlan,
} from "./types";

function factValue<T>(fact: Fact<T> | undefined) {
  return fact?.value ?? null;
}

function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  const normalized = String(value).replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStatus(value: unknown) {
  if (typeof value !== "string") return "available";
  if (value.trim().toLowerCase() === "available") return "available";
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizeDate(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
  if (!match) return value;

  const [, day, month, year] = match;
  const normalizedYear = year.length === 2 ? `20${year}` : year;
  return `${normalizedYear}-${month}-${day}`;
}

function extractProjectFacts(brochure: unknown): Record<string, Json> {
  if (!brochure || typeof brochure !== "object") return {};
  const data = brochure as Record<string, unknown>;

  return {
    project: data.project as Json,
    location: data.location as Json,
    project_type: data.project_type as Json,
    completion: data.completion as Json,
    ownership: data.ownership as Json,
    facilities: data.facilities as Json,
    descriptions: data.descriptions as Json,
  };
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function mapPriceListUnits(priceList: ExtractedPriceList | null): UnitInput[] {
  const priceListDate =
    normalizeDate(factValue(priceList?.price_list_date) as string | null) ?? undefined;

  return (priceList?.unit_inventory ?? [])
    .map((row): UnitInput | null => {
      const unitNumber = factValue(row.unit_number);
      if (!unitNumber) return null;

      return {
        unitNumber,
        buildingCode: factValue(row.building) ?? undefined,
        sourceTypeCode: factValue(row.unit_code) ?? undefined,
        unitType: factValue(row.unit_type) ?? undefined,
        bedrooms: parseNumber(factValue(row.bedrooms)),
        bathrooms: parseNumber(factValue(row.bathrooms)),
        sizeSqm: parseNumber(factValue(row.size_sqm)),
        floor: parseNumber(factValue(row.floor)),
        price: parseNumber(factValue(row.price)),
        currency: factValue(row.currency) ?? "THB",
        pricePerSqm: parseNumber(factValue(row.price_per_sqm)),
        availabilityStatus: normalizeStatus(factValue(row.availability_status)),
        sourceFile: row.unit_number?.source_file ?? undefined,
        sourcePage: row.unit_number?.page_number ?? undefined,
        sourceRow: row.source_row ?? null,
        priceListDate,
        raw: row,
      };
    })
    .filter((unit): unit is UnitInput => Boolean(unit));
}

function deriveBuildings(units: UnitInput[]): BuildingInput[] {
  const counts = new Map<string, number>();
  const maxFloor = new Map<string, number>();

  for (const unit of units) {
    if (!unit.buildingCode) continue;
    counts.set(unit.buildingCode, (counts.get(unit.buildingCode) ?? 0) + 1);
    if (unit.floor != null) {
      maxFloor.set(unit.buildingCode, Math.max(maxFloor.get(unit.buildingCode) ?? 0, unit.floor));
    }
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([buildingCode, unitsCount]) => ({
      buildingCode,
      name: `Building ${buildingCode}`,
      unitsCount,
      floorsCount: maxFloor.get(buildingCode),
      metadata: {
        source: "price_list_extraction",
      },
    }));
}

function createOperations(
  developer: Record<string, unknown>,
  location: Record<string, unknown>,
  project: Record<string, unknown>,
  buildings: BuildingInput[],
  units: UnitInput[],
): ImportOperation[] {
  return [
    {
      entity: "developer",
      action: "upsert",
      naturalKey: String(developer.slug),
      payload: developer,
    },
    {
      entity: "location",
      action: "upsert",
      naturalKey: String(location.slug),
      payload: location,
    },
    {
      entity: "project",
      action: "upsert",
      naturalKey: String(project.slug),
      payload: project,
      dependsOn: ["developer", "location"],
    },
    ...buildings.map((building) => ({
      entity: "building" as const,
      action: "upsert" as const,
      naturalKey: `${project.slug}:${building.buildingCode}`,
      payload: building,
      dependsOn: ["project" as const],
    })),
    ...units.map((unit) => ({
      entity: "unit" as const,
      action: "upsert" as const,
      naturalKey: `${project.slug}:${unit.unitNumber}`,
      payload: unit,
      dependsOn: ["project" as const, "building" as const],
    })),
    ...units
      .filter((unit) => unit.price != null)
      .map((unit) => ({
        entity: "unit_price_history" as const,
        action: "upsert" as const,
        naturalKey: `${project.slug}:${unit.unitNumber}:${unit.sourceFile ?? "unknown"}:${unit.priceListDate ?? "unknown"}`,
        payload: unit,
        dependsOn: ["unit" as const],
      })),
  ];
}

export function createImportPlan(
  manifest: ForeverManifest,
  validation: ProjectValidationReport,
  datasets: ExtractedDatasets,
  mode: ImportMode,
): ImportPlan {
  const projectFacts = extractProjectFacts(datasets.brochure);
  const units = mapPriceListUnits(datasets.priceList);
  const buildings = deriveBuildings(units);
  const developer = {
    slug: slugify(manifest.developer),
    name: manifest.developer,
    legal_name: manifest.developer,
    country: manifest.country,
    headquarters_location: `${manifest.province}, ${manifest.country}`,
    verification_status: "source_imported",
  };
  const location = {
    slug: slugify(manifest.location),
    area_name: manifest.location,
    country: manifest.country,
    province: manifest.province,
  };
  const project = {
    slug: manifest.project_slug,
    name: manifest.project_name,
    project_code: manifest.project_slug.toUpperCase(),
    project_type: manifest.project_type,
    location_area: manifest.location,
    address: `${manifest.location}, ${manifest.province}, ${manifest.country}`,
    is_active: true,
    public_status: "published",
    sales_status: "Available",
    metadata_keys: Object.keys(projectFacts),
  };

  return {
    projectSlug: manifest.project_slug,
    mode,
    manifest,
    validation,
    datasets,
    projectFacts,
    developer,
    location,
    project,
    buildings,
    units,
    priceHistoryRows: units.filter((unit) => unit.price != null),
    operations: createOperations(developer, location, project, buildings, units),
    rollback: {
      supported: mode === "execute",
      strategy: mode === "execute" ? "compensating_actions" : "not_required",
      steps: [],
      notes: [
        "Dry-run creates no database client and needs no rollback.",
        "Real imports use idempotent upserts; transaction-scoped rollback should replace compensating actions when the database layer supports it.",
      ],
    },
  };
}
