import type { Json } from "@/integrations/supabase/types";
import type { BuildingInput, UnitInput } from "./database";
import type { ForeverManifest } from "./manifest";
import type { ProjectValidationReport } from "./validator";
import type {
  CanonicalProject,
  ExtractedDatasets,
  ExtractedPriceList,
  ExtractedUnitPlanRow,
  ExtractedUnitPlans,
  Fact,
  ImportMode,
  ImportOperation,
  ImportPlan,
} from "./types";

function factValue<T>(fact: Fact<T> | undefined) {
  return fact?.value ?? null;
}

function isSourceBackedFact<T>(fact: Fact<T> | undefined): fact is Fact<T> {
  return Boolean(fact?.source_file && fact.value != null && fact.confidence !== "none");
}

function isFact<T>(value: unknown): value is Fact<T> {
  return Boolean(value && typeof value === "object" && "value" in value);
}

function sourceBackedFactValue<T>(fact: Fact<T> | undefined): T | null {
  return isSourceBackedFact(fact) ? fact.value : null;
}

function sourceBackedScalar<T>(value: Fact<T> | T | undefined): T | null {
  if (isFact<T>(value)) return sourceBackedFactValue(value);
  return value == null ? null : value;
}

function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  const normalized = String(value).replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStatus(value: unknown) {
  if (typeof value !== "string") return undefined;
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

function readFactAtPath(data: unknown, path: string[]): Fact | null {
  let current = data;

  for (const segment of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[segment];
  }

  if (!current || typeof current !== "object" || !("value" in current)) return null;
  return current as Fact;
}

function sourceBackedString(data: unknown, path: string[]): string | null {
  const fact = readFactAtPath(data, path);
  if (!fact || fact.value == null) return null;
  if (fact.confidence === "none") return null;
  return String(fact.value);
}

function sourceBackedNumber(data: unknown, path: string[]): number | null {
  const value = sourceBackedString(data, path);
  return parseNumber(value);
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function mapPriceListUnits(priceList: ExtractedPriceList | null): UnitInput[] {
  return (priceList?.unit_inventory ?? [])
    .map((row): UnitInput | null => {
      const unitNumber = sourceBackedFactValue(row.unit_number);
      if (!unitNumber) return null;
      const buildingCode = sourceBackedFactValue(row.building);
      if (!buildingCode) return null;

      return {
        unitNumber,
        buildingCode,
        sourceTypeCode: sourceBackedFactValue(row.unit_code) ?? undefined,
        unitType: sourceBackedFactValue(row.unit_type) ?? undefined,
        bedrooms: parseNumber(sourceBackedFactValue(row.bedrooms)),
        bathrooms: parseNumber(sourceBackedFactValue(row.bathrooms)),
        sizeSqm: parseNumber(sourceBackedFactValue(row.size_sqm)),
        floor: parseNumber(sourceBackedFactValue(row.floor)),
        availabilityStatus: normalizeStatus(sourceBackedFactValue(row.availability_status)),
        sourceFile: row.unit_number?.source_file ?? undefined,
        sourcePage: row.unit_number?.page_number ?? undefined,
        sourceRow: row.source_row ?? null,
        raw: {
          source: "price_list_extraction",
          source_row: row.source_row ?? null,
        },
      };
    })
    .filter((unit): unit is UnitInput => Boolean(unit));
}

function getUnitPlanRows(unitPlans: ExtractedUnitPlans | null): ExtractedUnitPlanRow[] {
  return unitPlans?.unit_inventory ?? unitPlans?.units ?? [];
}

function sourceFileFromUnitPlan(row: ExtractedUnitPlanRow) {
  if (isFact(row.unit_number)) return row.unit_number.source_file ?? undefined;
  return row.source_reference?.source_file ?? row.source_file;
}

function sourcePageFromUnitPlan(row: ExtractedUnitPlanRow) {
  if (isFact(row.unit_number)) return row.unit_number.page_number ?? undefined;
  return row.source_reference?.page_number ?? undefined;
}

function mapUnitPlanUnits(unitPlans: ExtractedUnitPlans | null): UnitInput[] {
  return getUnitPlanRows(unitPlans)
    .map((row): UnitInput | null => {
      const sourceFile = sourceFileFromUnitPlan(row);
      if (!sourceFile) return null;

      const unitNumber = sourceBackedScalar(row.unit_number);
      if (!unitNumber) return null;
      const buildingCode = sourceBackedScalar(row.building);
      if (!buildingCode) return null;

      return {
        unitNumber,
        buildingCode,
        sourceTypeCode: sourceBackedScalar(row.unit_code) ?? undefined,
        unitType: sourceBackedScalar(row.unit_type) ?? undefined,
        bedrooms: parseNumber(sourceBackedScalar(row.bedrooms)),
        bathrooms: parseNumber(sourceBackedScalar(row.bathrooms)),
        sizeSqm: parseNumber(sourceBackedScalar(row.size_sqm)),
        floor: parseNumber(sourceBackedScalar(row.floor)),
        availabilityStatus: normalizeStatus(sourceBackedScalar(row.availability_status)),
        sourceFile,
        sourcePage: sourcePageFromUnitPlan(row),
        sourceRow: row.source_row ?? null,
        raw: {
          source: "unit_plans_extraction",
          source_row: row.source_row ?? null,
        },
      };
    })
    .filter((unit): unit is UnitInput => Boolean(unit));
}

function mapCanonicalUnits(datasets: ExtractedDatasets): UnitInput[] {
  const unitPlanUnits = mapUnitPlanUnits(datasets.unitPlans as ExtractedUnitPlans | null);
  return unitPlanUnits.length ? unitPlanUnits : mapPriceListUnits(datasets.priceList);
}

function attachProjectToUnits(projectSlug: string, units: UnitInput[]): UnitInput[] {
  return units.map((unit) => ({
    ...unit,
    projectSlug,
  }));
}

function deriveBuildings(priceList: ExtractedPriceList | null): BuildingInput[] {
  const sourceRows = new Map<
    string,
    {
      unitsCount: number;
      floors: Set<number>;
      sourceFiles: Set<string>;
      sourcePages: Set<number>;
      sourceRows: number[];
    }
  >();

  for (const row of priceList?.unit_inventory ?? []) {
    const buildingCode = sourceBackedFactValue(row.building);
    if (!buildingCode) continue;

    const normalizedCode = String(buildingCode).trim();
    if (!normalizedCode) continue;

    const existing = sourceRows.get(normalizedCode) ?? {
      unitsCount: 0,
      floors: new Set<number>(),
      sourceFiles: new Set<string>(),
      sourcePages: new Set<number>(),
      sourceRows: [],
    };
    const floor = parseNumber(sourceBackedFactValue(row.floor));

    existing.unitsCount += 1;
    if (floor != null) existing.floors.add(floor);
    if (row.building?.source_file) existing.sourceFiles.add(row.building.source_file);
    if (row.building?.page_number != null) existing.sourcePages.add(row.building.page_number);
    if (row.source_row != null) existing.sourceRows.push(row.source_row);

    sourceRows.set(normalizedCode, existing);
  }

  return [...sourceRows.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([buildingCode, evidence]) => ({
      buildingCode,
      name: `Building ${buildingCode}`,
      unitsCount: evidence.unitsCount,
      floorsCount: evidence.floors.size ? Math.max(...evidence.floors) : undefined,
      metadata: {
        source: "price_list_extraction",
        source_files: [...evidence.sourceFiles].sort(),
        source_pages: [...evidence.sourcePages].sort((left, right) => left - right),
        source_rows: evidence.sourceRows.sort((left, right) => left - right),
      },
    }));
}

function createOperations(
  project: Record<string, unknown>,
  buildings: BuildingInput[],
  units: UnitInput[],
): ImportOperation[] {
  return [
    {
      entity: "project",
      action: "upsert",
      naturalKey: String(project.slug),
      payload: project,
    },
    ...buildings.map(
      (building): ImportOperation<BuildingInput> => ({
        entity: "building",
        action: "upsert",
        naturalKey: `${String(project.slug)}:${building.buildingCode}`,
        payload: building,
        dependsOn: ["project"],
      }),
    ),
    ...units.map(
      (unit): ImportOperation<UnitInput> => ({
        entity: "unit",
        action: "upsert",
        naturalKey: `${String(project.slug)}:${unit.unitNumber}`,
        payload: unit,
        dependsOn: ["project", "building"],
      }),
    ),
  ];
}

export function createCanonicalProject(
  manifest: ForeverManifest,
  validation: ProjectValidationReport,
  datasets: ExtractedDatasets,
): CanonicalProject {
  const brochure = datasets.brochure;

  return {
    name: manifest.project_name,
    slug: manifest.project_slug,
    developer: manifest.developer,
    country: manifest.country,
    province: manifest.province,
    locationArea: manifest.location,
    projectType: manifest.project_type,
    publicStatus: null,
    salesStatus: null,
    sourceVersion: manifest.source_version,
    importManifest: {
      manifestFormat: manifest.manifest_format,
      manifestVersion: manifest.manifest_version,
      createdAt: manifest.created_at,
      projectSlug: manifest.project_slug,
    },
    importReadiness: {
      ready: validation.ready,
      importStatusReady: validation.importStatusReady,
      validationIssueCount: validation.issues.length,
    },
    optional: {
      projectCode: null,
      address: null,
      shortDescription: sourceBackedString(brochure, ["descriptions", "short_description"]),
      fullDescription: sourceBackedString(brochure, ["descriptions", "full_description"]),
      constructionStatus: sourceBackedString(brochure, ["completion", "construction_status"]),
      completionDate: sourceBackedString(brochure, ["completion", "completion_date"]),
      ownershipType: sourceBackedString(brochure, ["ownership", "type"]),
      distanceToBeach: sourceBackedString(brochure, ["location", "beach_distance"]),
      distanceToAirport: sourceBackedString(brochure, ["location", "airport_distance"]),
      latitude: sourceBackedNumber(brochure, ["location", "latitude"]),
      longitude: sourceBackedNumber(brochure, ["location", "longitude"]),
      mainImage: null,
      brochureUrl: null,
      startingPrice: null,
      priceRange: null,
      verifiedPriceLabel: null,
      lastPriceUpdate: normalizeDate(
        factValue(datasets.priceList?.price_list_date) as string | null,
      ),
      lastInspectionDate: null,
      trustNote: null,
      marketPosition: null,
      verdict: null,
      highlights: [],
    },
  };
}

export function createImportPlan(
  manifest: ForeverManifest,
  validation: ProjectValidationReport,
  datasets: ExtractedDatasets,
  mode: ImportMode,
): ImportPlan {
  const projectFacts = extractProjectFacts(datasets.brochure);
  const canonicalProject = createCanonicalProject(manifest, validation, datasets);
  const units = attachProjectToUnits(manifest.project_slug, mapCanonicalUnits(datasets));
  const buildings = deriveBuildings(datasets.priceList);
  const project = { ...canonicalProject };

  return {
    projectSlug: manifest.project_slug,
    mode,
    manifest,
    validation,
    datasets,
    canonicalProject,
    projectFacts,
    developer: {},
    location: {},
    project,
    buildings,
    units,
    priceHistoryRows: [],
    operations: createOperations(project, buildings, units),
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
