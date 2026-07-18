import type { BuildingInput, PriceHistoryInput, UnitInput } from "../database";
import type {
  CollisionInspectionReader,
  TargetBuildingRow,
  TargetDeveloperRow,
  TargetLocationRow,
  TargetPriceHistoryRow,
  TargetProjectRow,
  TargetUnitRow,
} from "../collision-reader";
import type { InspectPlanCollisionsInput } from "../collision-inspector";
import type { ImportOperation } from "../types";
import {
  buildingPersistenceProjection,
  priceHistoryPersistenceProjection,
  projectPersistenceProjection,
  slugify,
  unitPersistenceProjection,
  type ProjectManifestFields,
} from "../persistence-projection";

/**
 * Hermetic, credential-free fixtures for RC5.5B collision-inspection tests.
 * Target rows are derived from the shared persistence projections so a genuine
 * `exact_match` is a true full-field match. No gitignored Coralina document is
 * required.
 */

const PRICE_SOURCE = "developer_price_list" as const;
const SOURCE_FILE = "price-list.pdf";
const PRICE_LIST_DATE = "2026-07-03";

export const MANIFEST: ProjectManifestFields = {
  project_slug: "coralina",
  project_name: "The Title Coralina Kamala",
  project_type: "Condominium",
  developer: "Rhom Bho Property",
  country: "Thailand",
  province: "Phuket",
  location: "Kamala",
};

export const PROJECT_ID = "project-1";
export const DEVELOPER_ID = "dev-1";
export const LOCATION_ID = "loc-1";

export const HERMETIC_TARGET: InspectPlanCollisionsInput["target"] = "local";
export const HERMETIC_IDENTITY = { projectId: "forever-local" };

export function developerRow(overrides: Partial<TargetDeveloperRow> = {}): TargetDeveloperRow {
  return { id: DEVELOPER_ID, slug: slugify(MANIFEST.developer), ...overrides };
}

export function locationRow(overrides: Partial<TargetLocationRow> = {}): TargetLocationRow {
  return { id: LOCATION_ID, slug: slugify(MANIFEST.location), ...overrides };
}

// ----- Operation builders ---------------------------------------------------

export function projectOperation(slug = MANIFEST.project_slug): ImportOperation {
  return { entity: "project", action: "upsert", naturalKey: slug, payload: { slug } };
}

export function buildingOperation(
  code: string,
  overrides: Partial<BuildingInput> = {},
): ImportOperation<BuildingInput> {
  const payload: BuildingInput = {
    buildingCode: code,
    name: `Building ${code}`,
    unitsCount: 10,
    floorsCount: 5,
    metadata: { source: "price_list_extraction", building_code: code },
    ...overrides,
  };
  return {
    entity: "building",
    action: "upsert",
    naturalKey: `${MANIFEST.project_slug}:${code}`,
    payload,
    dependsOn: ["project"],
  };
}

export function unitOperation(
  unitNumber: string,
  overrides: Partial<UnitInput> = {},
): ImportOperation<UnitInput> {
  const payload: UnitInput = {
    projectSlug: MANIFEST.project_slug,
    unitNumber,
    buildingCode: "A",
    sourceTypeCode: "1BR",
    unitType: "1BR",
    bedrooms: 1,
    bathrooms: 1,
    sizeSqm: 45,
    floor: 3,
    currency: "THB",
    price: 5_000_000,
    pricePerSqm: 111_111,
    availabilityStatus: "available",
    sourceFile: SOURCE_FILE,
    sourcePage: 1,
    sourceRow: 1,
    priceListDate: PRICE_LIST_DATE,
    raw: { source: "price_list_extraction", source_row: 1 },
    ...overrides,
  };
  return {
    entity: "unit",
    action: "upsert",
    naturalKey: `${MANIFEST.project_slug}:${unitNumber}`,
    payload,
    dependsOn: ["project", "building"],
  };
}

export function priceOperation(
  unitNumber: string,
  overrides: Partial<PriceHistoryInput> = {},
): ImportOperation<PriceHistoryInput> {
  const payload: PriceHistoryInput = {
    projectSlug: MANIFEST.project_slug,
    unitNumber,
    price: 5_000_000,
    currency: "THB",
    currencyDecision: {
      value: "THB",
      status: "inferred_default",
      confidence: "medium",
      priceEvidence: [],
    } as unknown as PriceHistoryInput["currencyDecision"],
    priceSource: PRICE_SOURCE,
    recordedDate: PRICE_LIST_DATE,
    priceListDate: PRICE_LIST_DATE,
    sourceFile: SOURCE_FILE,
    sourcePage: 1,
    sourceRow: 1,
    pricePerSqm: 111_111,
    buildingCode: "A",
    floor: 3,
    unitType: "1BR",
    bedrooms: 1,
    sizeSqm: 45,
    availabilityStatus: "available",
    raw: { source: "price_list_extraction", source_row: 1 },
    ...overrides,
  };
  return {
    entity: "unit_price_history",
    action: "upsert",
    naturalKey: [
      MANIFEST.project_slug,
      unitNumber,
      payload.priceSource,
      payload.sourceFile ?? "unknown",
      payload.sourcePage ?? "none",
      payload.priceListDate ?? "none",
      payload.sourceRow ?? "none",
    ].join(":"),
    payload,
    dependsOn: ["project", "unit"],
  };
}

// ----- Target rows derived from persistence projections ---------------------

export function targetProject(overrides: Partial<TargetProjectRow> = {}): TargetProjectRow {
  return {
    id: PROJECT_ID,
    ...projectPersistenceProjection(MANIFEST, {
      developerId: DEVELOPER_ID,
      locationId: LOCATION_ID,
    }),
    ...overrides,
  } as unknown as TargetProjectRow;
}

export function buildingIdFor(code: string): string {
  return `building-${code}`;
}

export function unitIdFor(unitNumber: string): string {
  return `unit-${unitNumber}`;
}

export function targetBuilding(
  operation: ImportOperation<BuildingInput>,
  overrides: Partial<TargetBuildingRow> = {},
): TargetBuildingRow {
  return {
    id: buildingIdFor(operation.payload.buildingCode),
    ...buildingPersistenceProjection(PROJECT_ID, operation.payload),
    ...overrides,
  } as unknown as TargetBuildingRow;
}

export function targetUnit(
  operation: ImportOperation<UnitInput>,
  overrides: Partial<TargetUnitRow> = {},
): TargetUnitRow {
  const buildingId = operation.payload.buildingCode
    ? buildingIdFor(operation.payload.buildingCode)
    : null;
  return {
    id: unitIdFor(operation.payload.unitNumber),
    ...unitPersistenceProjection(PROJECT_ID, buildingId, operation.payload),
    ...overrides,
  } as unknown as TargetUnitRow;
}

export function targetPrice(
  operation: ImportOperation<PriceHistoryInput>,
  overrides: Partial<TargetPriceHistoryRow> = {},
): TargetPriceHistoryRow {
  return {
    id: `price-${operation.payload.unitNumber}`,
    ...priceHistoryPersistenceProjection(
      unitIdFor(operation.payload.unitNumber),
      operation.payload,
    ),
    ...overrides,
  } as unknown as TargetPriceHistoryRow;
}

// ----- Fake reader ----------------------------------------------------------

export interface FakeReaderCall {
  method: string;
  projectId?: string;
  keys?: string[];
  slug?: string;
}

export interface FakeReaderConfig {
  projects?: TargetProjectRow[];
  developers?: TargetDeveloperRow[];
  locations?: TargetLocationRow[];
  buildings?: TargetBuildingRow[];
  units?: TargetUnitRow[];
  priceHistory?: TargetPriceHistoryRow[];
  throwOn?: Partial<
    Record<"project" | "developer" | "location" | "building" | "unit" | "price", string>
  >;
}

/**
 * Records every call (method + filter keys) so tests can prove which reads
 * happened, that reads are plan-bounded, and that no mutation method exists.
 */
export class FakeCollisionReader implements CollisionInspectionReader {
  public readonly calls: string[] = [];
  public readonly callLog: FakeReaderCall[] = [];

  constructor(private readonly config: FakeReaderConfig = {}) {}

  // Reads return the configured rows verbatim. The real adapter narrows with
  // `.eq`/`.in`; returning rows as-is lets tests exercise the inspector's own
  // strict validation (e.g. a contract-violating row the adapter would filter).
  async readProjectRows(slug: string): Promise<TargetProjectRow[]> {
    this.calls.push("readProjectRows");
    this.callLog.push({ method: "readProjectRows", slug });
    if (this.config.throwOn?.project) throw new Error(this.config.throwOn.project);
    return this.config.projects ?? [];
  }

  async readDeveloperRows(slug: string): Promise<TargetDeveloperRow[]> {
    this.calls.push("readDeveloperRows");
    this.callLog.push({ method: "readDeveloperRows", slug });
    if (this.config.throwOn?.developer) throw new Error(this.config.throwOn.developer);
    return this.config.developers ?? [developerRow({ slug })];
  }

  async readLocationRows(slug: string): Promise<TargetLocationRow[]> {
    this.calls.push("readLocationRows");
    this.callLog.push({ method: "readLocationRows", slug });
    if (this.config.throwOn?.location) throw new Error(this.config.throwOn.location);
    return this.config.locations ?? [locationRow({ slug })];
  }

  async readBuildingRows(projectId: string, buildingCodes: string[]): Promise<TargetBuildingRow[]> {
    this.calls.push("readBuildingRows");
    this.callLog.push({ method: "readBuildingRows", projectId, keys: [...buildingCodes] });
    if (this.config.throwOn?.building) throw new Error(this.config.throwOn.building);
    return this.config.buildings ?? [];
  }

  async readUnitRows(projectId: string, unitCodes: string[]): Promise<TargetUnitRow[]> {
    this.calls.push("readUnitRows");
    this.callLog.push({ method: "readUnitRows", projectId, keys: [...unitCodes] });
    if (this.config.throwOn?.unit) throw new Error(this.config.throwOn.unit);
    return this.config.units ?? [];
  }

  async readPriceHistoryRows(unitIds: string[]): Promise<TargetPriceHistoryRow[]> {
    this.calls.push("readPriceHistoryRows");
    this.callLog.push({ method: "readPriceHistoryRows", keys: [...unitIds] });
    if (this.config.throwOn?.price) throw new Error(this.config.throwOn.price);
    return this.config.priceHistory ?? [];
  }
}

export function baseInput(
  operations: ImportOperation[],
  reader: CollisionInspectionReader,
  overrides: Partial<InspectPlanCollisionsInput> = {},
): InspectPlanCollisionsInput {
  const counts = {
    projects: operations.filter((op) => op.entity === "project").length,
    buildings: operations.filter((op) => op.entity === "building").length,
    units: operations.filter((op) => op.entity === "unit").length,
    priceHistoryRows: operations.filter((op) => op.entity === "unit_price_history").length,
    operations: operations.length,
  };
  return {
    reader,
    target: HERMETIC_TARGET,
    targetIdentity: HERMETIC_IDENTITY,
    sourceVersion: "2.0.0",
    planHash: "a".repeat(64),
    shortPlanHash: "a".repeat(12),
    operationCounts: counts,
    operations,
    manifest: MANIFEST,
    ...overrides,
  };
}

/**
 * Hermetic Coralina-shaped plan: 1 project, 8 buildings, 198 units, 198 price
 * operations, 405 total — matching the real Coralina dry-run shape.
 */
export function coralinaHermeticOperations(): ImportOperation[] {
  const buildingCodes = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const operations: ImportOperation[] = [projectOperation()];

  for (const code of buildingCodes) {
    operations.push(buildingOperation(code));
  }

  const unitOps: ImportOperation[] = [];
  const priceOps: ImportOperation[] = [];
  for (let index = 0; index < 198; index += 1) {
    const code = buildingCodes[index % buildingCodes.length];
    const unitNumber = `${code}-${String(index + 1).padStart(3, "0")}`;
    unitOps.push(unitOperation(unitNumber, { buildingCode: code }));
    priceOps.push(priceOperation(unitNumber, { buildingCode: code }));
  }

  return [...operations, ...unitOps, ...priceOps];
}
