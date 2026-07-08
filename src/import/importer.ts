import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Json } from "@/integrations/supabase/types";
import { createDatabaseLayer, type BuildingInput, type DatabaseLayer, type UnitInput } from "./database";
import { getProjectRoot, loadManifest } from "./manifest";
import { logStep, logSummary, logWarning, type ImportSummary } from "./logger";
import { validateProjectImport } from "./validator";

interface Fact<T = unknown> {
  value: T | null;
  source_file?: string | null;
  page_number?: number | null;
  sheet_name?: string | null;
  confidence?: string;
}

interface ExtractedPriceListRow {
  source_row?: number;
  unit_number?: Fact<string>;
  unit_code?: Fact<string>;
  building?: Fact<string>;
  floor?: Fact<string | number>;
  unit_type?: Fact<string>;
  bedrooms?: Fact<string | number>;
  bathrooms?: Fact<string | number>;
  size_sqm?: Fact<string | number>;
  price?: Fact<string | number>;
  currency?: Fact<string>;
  price_per_sqm?: Fact<string | number>;
  availability_status?: Fact<string>;
  payment_terms?: Fact<string>;
  promotion_discount_notes?: Fact<string>;
}

interface ExtractedPriceList {
  price_list_date?: Fact<string>;
  unit_inventory?: ExtractedPriceListRow[];
}

export interface ImportProjectOptions {
  projectSlug: string;
  projectsRoot?: string;
  database?: DatabaseLayer;
  dryRun?: boolean;
}

export interface DryRunPayloadSummary {
  developer: Record<string, unknown>;
  location: Record<string, unknown>;
  project: Record<string, unknown>;
  buildings: BuildingInput[];
  units: UnitInput[];
  priceHistoryRows: UnitInput[];
}

function factValue<T>(fact: Fact<T> | undefined) {
  return fact?.value ?? null;
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
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

function mapPriceListUnits(priceList: ExtractedPriceList | null): UnitInput[] {
  const priceListDate = normalizeDate(factValue(priceList?.price_list_date) as string | null) ?? undefined;

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

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function prepareDryRunPayloads(
  manifest: Awaited<ReturnType<typeof loadManifest>>,
  projectFacts: Record<string, Json>,
  buildings: BuildingInput[],
  units: UnitInput[],
): DryRunPayloadSummary {
  return {
    developer: {
      slug: slugify(manifest.developer),
      name: manifest.developer,
      legal_name: manifest.developer,
      country: manifest.country,
      headquarters_location: `${manifest.province}, ${manifest.country}`,
      verification_status: "source_imported",
    },
    location: {
      slug: slugify(manifest.location),
      area_name: manifest.location,
      country: manifest.country,
      province: manifest.province,
    },
    project: {
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
    },
    buildings,
    units,
    priceHistoryRows: units.filter((unit) => unit.price != null),
  };
}

function logDryRunPayloads(payloads: DryRunPayloadSummary) {
  logStep("Developer", String(payloads.developer.name));
  logStep("Location", String(payloads.location.area_name));
  logStep("Project", String(payloads.project.slug));
  logStep("Buildings", String(payloads.buildings.length));
  logStep("Units", String(payloads.units.length));
  logStep("Prices", String(payloads.priceHistoryRows.length));
  logWarning("Dry run only. No Supabase client was created and no database writes were performed.");
}

export async function importProject(options: ImportProjectOptions): Promise<ImportSummary> {
  const projectsRoot = options.projectsRoot ?? "forever-data/projects";
  const projectRoot = getProjectRoot(options.projectSlug, projectsRoot);

  const manifest = await loadManifest(options.projectSlug, projectsRoot);
  logStep("Manifest", manifest.project_slug);

  const validation = await validateProjectImport(manifest, projectsRoot);
  if (!validation.ready) {
    const details = validation.issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n");
    throw new Error(`Project is not ready for import.\n${details}`);
  }
  logStep("Validation");

  const brochure = await readJsonIfExists(join(projectRoot, "extracted", "brochure.json"));
  const priceList = await readJsonIfExists<ExtractedPriceList>(join(projectRoot, "extracted", "price-list.json"));
  const projectFacts = extractProjectFacts(brochure);
  const units = mapPriceListUnits(priceList);
  const buildings = deriveBuildings(units);

  if (options.dryRun) {
    const payloads = prepareDryRunPayloads(manifest, projectFacts, buildings, units);
    logDryRunPayloads(payloads);

    const summary = {
      projectSlug: manifest.project_slug,
      buildings: payloads.buildings.length,
      units: payloads.units.length,
      prices: payloads.priceHistoryRows.length,
      skipped: units.length - payloads.priceHistoryRows.length,
    };

    logStep("Finished", "dry run");
    logSummary(summary);
    return summary;
  }

  const database = options.database ?? createDatabaseLayer();

  const developer = await database.upsertDeveloper(manifest);
  logStep("Developer", developer.name);

  const location = await database.upsertLocation(manifest);
  logStep("Location", location.area_name ?? manifest.location);

  const project = await database.upsertProject(manifest, developer, location, projectFacts);
  logStep("Project", project.slug);

  const buildingIds = await database.upsertBuildings(project, buildings);
  logStep("Buildings", String(buildingIds.size));

  const unitIds = await database.upsertUnits(project, buildingIds, units);
  logStep("Units", String(unitIds.size));

  const priceCount = await database.upsertPriceHistory(unitIds, units);
  logStep("Prices", String(priceCount));

  const skipped = units.length - unitIds.size;
  if (skipped > 0) logWarning(`${skipped} unit rows were skipped.`);

  const summary = {
    projectSlug: manifest.project_slug,
    developerId: developer.id,
    locationId: location.id,
    projectId: project.id,
    buildings: buildingIds.size,
    units: unitIds.size,
    prices: priceCount,
    skipped,
  };

  logStep("Finished");
  logSummary(summary);
  return summary;
}
