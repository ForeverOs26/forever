import { createHash } from "node:crypto";

import type { BuildingInput, PriceHistoryInput, UnitInput } from "./database";
import type { ImportTarget, ImportTargetIdentity } from "./import-targets";
import type { ImportOperationCounts } from "./plan-hash";
import type { ImportEntityType, ImportOperation } from "./types";
import {
  assertReadOnlyReader,
  CollisionReadError,
  type CollisionInspectionReader,
  type TargetBuildingRow,
  type TargetDeveloperRow,
  type TargetLocationRow,
  type TargetPriceHistoryRow,
  type TargetProjectRow,
  type TargetUnitRow,
} from "./collision-reader";
import {
  buildingPersistenceProjection,
  canonicalJsonString,
  developerNaturalKey,
  locationNaturalKey,
  priceHistoryPersistenceProjection,
  pricePersistenceDedupeKey,
  projectPersistenceProjection,
  unitPersistenceProjection,
  type ProjectManifestFields,
} from "./persistence-projection";

export const COLLISION_REPORT_SCHEMA_VERSION = "1" as const;

export type CollisionClassification =
  | "absent"
  | "exact_match"
  | "update_required"
  | "duplicate_target_rows"
  | "identity_conflict"
  | "inspection_error";

export const COLLISION_CLASSIFICATIONS: readonly CollisionClassification[] = [
  "absent",
  "exact_match",
  "update_required",
  "duplicate_target_rows",
  "identity_conflict",
  "inspection_error",
];

const BLOCKING_CLASSIFICATIONS: ReadonlySet<CollisionClassification> = new Set([
  "duplicate_target_rows",
  "identity_conflict",
  "inspection_error",
]);

export const SUPPORTED_COLLISION_ENTITIES: readonly ImportEntityType[] = [
  "project",
  "building",
  "unit",
  "unit_price_history",
];

export type CollisionInspectionStatus = "clean" | "changes_detected" | "blocked";

export type DependencyClassification =
  | "present_exactly_once"
  | "absent"
  | "ambiguous"
  | "identity_conflict"
  | "invalid_or_null_natural_key"
  | "inspection_error";

export interface DependencyFinding {
  dependency: "developer" | "location";
  naturalKey: string;
  classification: DependencyClassification;
  targetRowCount: number;
  blocking: boolean;
  detail: string;
}

export type PrerequisitesStatus = "ready" | "missing" | "blocked";

export interface CollisionFinding {
  entity: ImportEntityType;
  naturalKey: string;
  classification: CollisionClassification;
  blocking: boolean;
  changedFields: string[];
  targetRowCount: number;
  detail: string;
}

export interface CollisionInspectionReport {
  schemaVersion: typeof COLLISION_REPORT_SCHEMA_VERSION;
  projectSlug: string;
  approvedTarget: ImportTarget;
  targetIdentity: { projectId: string };
  planHash: string;
  shortPlanHash: string;
  sourceVersion: string;
  operationCounts: ImportOperationCounts;
  totalInspectedOperations: number;
  countsByClassification: Record<CollisionClassification, number>;
  findings: CollisionFinding[];
  blockingFindings: CollisionFinding[];
  dependencies: DependencyFinding[];
  prerequisitesStatus: PrerequisitesStatus;
  projectAnchorStatus: "absent_prerequisites_ready" | "absent_prerequisites_missing" | "present" | "blocked";
  operationSetError: string | null;
  readOnlyConfirmed: true;
  executeEnabled: false;
  writesPerformed: 0;
  status: CollisionInspectionStatus;
}

export interface InspectPlanCollisionsInput {
  reader: CollisionInspectionReader;
  target: ImportTarget;
  targetIdentity: ImportTargetIdentity;
  planHash: string;
  shortPlanHash: string;
  sourceVersion: string;
  operationCounts: ImportOperationCounts;
  operations: ImportOperation[];
  manifest: ProjectManifestFields;
}

type ComparableFieldType = "string" | "number" | "boolean" | "date" | "json";

interface ComparableField {
  field: string;
  type: ComparableFieldType;
}

const PROJECT_FIELDS: ComparableField[] = [
  { field: "slug", type: "string" },
  { field: "name", type: "string" },
  { field: "developer_id", type: "string" },
  { field: "location_id", type: "string" },
  { field: "project_code", type: "string" },
  { field: "project_type", type: "string" },
  { field: "location_area", type: "string" },
  { field: "address", type: "string" },
  { field: "short_description", type: "string" },
  { field: "full_description", type: "string" },
  { field: "is_active", type: "boolean" },
  { field: "public_status", type: "string" },
  { field: "sales_status", type: "string" },
];

const BUILDING_FIELDS: ComparableField[] = [
  { field: "project_id", type: "string" },
  { field: "building_code", type: "string" },
  { field: "name", type: "string" },
  { field: "building_type", type: "string" },
  { field: "floors_count", type: "number" },
  { field: "units_count", type: "number" },
  { field: "metadata", type: "json" },
];

const UNIT_FIELDS: ComparableField[] = [
  { field: "project_id", type: "string" },
  { field: "building_id", type: "string" },
  { field: "unit_code", type: "string" },
  { field: "unit_type", type: "string" },
  { field: "bedrooms", type: "number" },
  { field: "bathrooms", type: "number" },
  { field: "size_sqm", type: "number" },
  { field: "floor", type: "number" },
  { field: "base_price_thb", type: "number" },
  { field: "price_per_sqm", type: "number" },
  { field: "availability_status", type: "string" },
  { field: "unit_status", type: "string" },
  { field: "metadata", type: "json" },
];

const PRICE_FIELDS: ComparableField[] = [
  { field: "unit_id", type: "string" },
  { field: "price", type: "number" },
  { field: "currency", type: "string" },
  { field: "price_source", type: "string" },
  { field: "source_file", type: "string" },
  { field: "source_page", type: "number" },
  { field: "price_list_date", type: "date" },
  { field: "recorded_at", type: "date" },
  { field: "metadata", type: "json" },
];

const ENTITY_ORDER: Record<ImportEntityType, number> = {
  developer: 0,
  location: 1,
  project: 2,
  building: 3,
  unit: 4,
  unit_price_history: 5,
};

function normalizeDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : text;
}

function coerce(type: ComparableFieldType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "number": {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case "boolean":
      return Boolean(value);
    case "date":
      return normalizeDate(value);
    case "json":
      return canonicalJsonString(value);
    case "string": {
      const text = String(value);
      return text.length ? text : null;
    }
  }
}

function validFieldShape(type: ComparableFieldType, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  switch (type) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return typeof value === "string";
    case "json":
      return typeof value === "object";
    case "number": {
      if (typeof value === "number") return Number.isFinite(value);
      if (typeof value === "string") {
        return value.trim() !== "" && Number.isFinite(Number(value));
      }
      return false;
    }
  }
}

/** All comparable fields with an invalid shape, as deterministic codes. */
function fieldShapeErrorCodes(fields: ComparableField[], row: Record<string, unknown>): string[] {
  return fields
    .filter(({ field, type }) => !validFieldShape(type, row[field]))
    .map(({ field }) => `invalid_shape:${field}`);
}

function changedFieldsFor(
  fields: ComparableField[],
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): string[] {
  return fields
    .filter(({ field, type }) => coerce(type, expected[field]) !== coerce(type, actual[field]))
    .map(({ field }) => field)
    .sort();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Deterministic, deduplicated, sorted diagnostic detail. */
function diagnostic(codes: Iterable<string>): string {
  return [...new Set(codes)].sort().join(",");
}

// ---------------------------------------------------------------------------
// Read phase results (sanitized codes only — never raw provider messages)
// ---------------------------------------------------------------------------

type PhaseResult<T> = { ok: true; value: T } | { ok: false; code: string };

async function safeRead<T>(fn: () => Promise<T>, fallbackCode: string): Promise<PhaseResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    const code = error instanceof CollisionReadError ? error.code : fallbackCode;
    return { ok: false, code };
  }
}

function finding(
  entity: ImportEntityType,
  operation: ImportOperation,
  classification: CollisionClassification,
  targetRowCount: number,
  detail: string,
  changedFields: string[] = [],
): CollisionFinding {
  return {
    entity,
    naturalKey: operation.naturalKey,
    classification,
    blocking: BLOCKING_CLASSIFICATIONS.has(classification),
    changedFields,
    targetRowCount,
    detail,
  };
}

// ---------------------------------------------------------------------------
// Planner natural keys (must match src/import/planner.ts exactly)
// ---------------------------------------------------------------------------

function plannerBuildingKey(slug: string, payload: BuildingInput): string {
  return `${slug}:${payload.buildingCode}`;
}

function plannerUnitKey(slug: string, payload: UnitInput): string {
  return `${slug}:${payload.unitNumber}`;
}

function plannerPriceKey(slug: string, payload: PriceHistoryInput): string {
  return [
    slug,
    payload.unitNumber,
    payload.priceSource,
    payload.sourceFile ?? "unknown",
    payload.sourcePage ?? "none",
    payload.priceListDate ?? "none",
    payload.sourceRow ?? "none",
  ].join(":");
}

// ---------------------------------------------------------------------------
// Operation-set validation (fail closed before any read)
// ---------------------------------------------------------------------------

interface PartitionedOperations {
  buildingOps: ImportOperation<BuildingInput>[];
  unitOps: ImportOperation<UnitInput>[];
  priceOps: ImportOperation<PriceHistoryInput>[];
}

function partitionOperations(operations: ImportOperation[]): PartitionedOperations {
  const buildingOps: ImportOperation<BuildingInput>[] = [];
  const unitOps: ImportOperation<UnitInput>[] = [];
  const priceOps: ImportOperation<PriceHistoryInput>[] = [];

  for (const operation of operations) {
    if (operation.entity === "building")
      buildingOps.push(operation as ImportOperation<BuildingInput>);
    else if (operation.entity === "unit") unitOps.push(operation as ImportOperation<UnitInput>);
    else if (operation.entity === "unit_price_history")
      priceOps.push(operation as ImportOperation<PriceHistoryInput>);
  }

  return { buildingOps, unitOps, priceOps };
}

function payloadMatchesEntity(operation: ImportOperation): boolean {
  const payload = operation.payload as Record<string, unknown> | null | undefined;
  if (!payload || typeof payload !== "object") return false;
  switch (operation.entity) {
    case "project":
      return isNonEmptyString(payload.slug);
    case "building":
      return isNonEmptyString(payload.buildingCode);
    case "unit":
      return isNonEmptyString(payload.unitNumber);
    case "unit_price_history":
      return isNonEmptyString(payload.unitNumber) && isNonEmptyString(payload.priceSource);
    default:
      return false;
  }
}

/**
 * Shared plan-contract validation used by both the RC5.5B collision inspector
 * and the RC5.5C transaction executor: planner natural keys, per-entity and
 * total operation counts, entity/payload agreement, duplicate planner keys,
 * unsupported entities, and database persistence-key uniqueness. Returns a
 * deterministic reason string, or null when the operation set is valid.
 */
export function validateImportOperationSet(input: {
  operations: ImportOperation[];
  operationCounts: ImportOperationCounts;
  manifest: ProjectManifestFields;
}): string | null {
  const { operations, operationCounts, manifest } = input;
  const slug = manifest.project_slug;

  if (operationCounts.operations !== operations.length) {
    return `operationCounts.operations (${operationCounts.operations}) does not equal operations.length (${operations.length}).`;
  }

  for (const operation of operations) {
    if (!SUPPORTED_COLLISION_ENTITIES.includes(operation.entity)) {
      return `Unsupported operation entity "${operation.entity}" is not inspectable in RC5.5B.`;
    }
    if (!isNonEmptyString(operation.naturalKey)) {
      return `Operation of entity "${operation.entity}" has an empty natural key.`;
    }
    if (!payloadMatchesEntity(operation)) {
      return `Operation payload does not match its entity type: ${operation.entity} "${operation.naturalKey}".`;
    }
  }

  const projectOps = operations.filter((operation) => operation.entity === "project");
  if (projectOps.length !== 1) {
    return `Exactly one project operation is required; found ${projectOps.length}.`;
  }
  if (projectOps[0].naturalKey !== slug) {
    return `Project natural key "${projectOps[0].naturalKey}" does not equal the manifest slug "${slug}".`;
  }

  const { buildingOps, unitOps, priceOps } = partitionOperations(operations);

  for (const op of buildingOps) {
    const expected = plannerBuildingKey(slug, op.payload);
    if (op.naturalKey !== expected) {
      return `Building natural key "${op.naturalKey}" does not equal "${expected}".`;
    }
  }
  for (const op of unitOps) {
    const expected = plannerUnitKey(slug, op.payload);
    if (op.naturalKey !== expected) {
      return `Unit natural key "${op.naturalKey}" does not equal "${expected}".`;
    }
  }
  for (const op of priceOps) {
    const expected = plannerPriceKey(slug, op.payload);
    if (op.naturalKey !== expected) {
      return `Price-history natural key "${op.naturalKey}" does not match its payload.`;
    }
  }

  // Per-entity operation-count invariants.
  if (operationCounts.projects !== projectOps.length) {
    return `operationCounts.projects (${operationCounts.projects}) does not equal ${projectOps.length}.`;
  }
  if (operationCounts.buildings !== buildingOps.length) {
    return `operationCounts.buildings (${operationCounts.buildings}) does not equal ${buildingOps.length}.`;
  }
  if (operationCounts.units !== unitOps.length) {
    return `operationCounts.units (${operationCounts.units}) does not equal ${unitOps.length}.`;
  }
  if (operationCounts.priceHistoryRows !== priceOps.length) {
    return `operationCounts.priceHistoryRows (${operationCounts.priceHistoryRows}) does not equal ${priceOps.length}.`;
  }

  // No duplicate planner natural keys (globally).
  const seenKeys = new Set<string>();
  for (const operation of operations) {
    if (seenKeys.has(operation.naturalKey)) {
      return `Duplicate operation natural key: "${operation.naturalKey}".`;
    }
    seenKeys.add(operation.naturalKey);
  }

  // No two price-history operations may collapse to the same database persistence
  // key (which excludes sourceRow).
  const seenPersistence = new Set<string>();
  for (const op of priceOps) {
    const key = pricePersistenceDedupeKey(op.payload.unitNumber, op.payload);
    if (seenPersistence.has(key)) {
      return `Two price-history operations share the same database persistence key (differing only by non-key fields such as sourceRow).`;
    }
    seenPersistence.add(key);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Strict target-row validation (deterministic, order-independent diagnostics)
// ---------------------------------------------------------------------------

interface KeyedValidation<Row> {
  validByKey: Map<string, Row[]>;
  keyedErrors: Map<string, Set<string>>;
  structuralErrors: Set<string>;
}

function emptyKeyed<Row>(): KeyedValidation<Row> {
  return { validByKey: new Map(), keyedErrors: new Map(), structuralErrors: new Set() };
}

function addKeyedErrors<Row>(result: KeyedValidation<Row>, key: string, codes: string[]): void {
  const bucket = result.keyedErrors.get(key) ?? new Set<string>();
  for (const code of codes) bucket.add(code);
  result.keyedErrors.set(key, bucket);
}

function pushValid<Row>(map: Map<string, Row[]>, key: string, row: Row): void {
  const bucket = map.get(key) ?? [];
  bucket.push(row);
  map.set(key, bucket);
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

export async function inspectPlanCollisions(
  input: InspectPlanCollisionsInput,
): Promise<CollisionInspectionReport> {
  assertReadOnlyReader(input.reader);

  const operationSetError = validateImportOperationSet(input);
  if (operationSetError) {
    const findings = input.operations.map((operation) =>
      finding(operation.entity, operation, "inspection_error", 0, "operation_set_invalid"),
    );
    return buildReport(input, findings, operationSetError);
  }

  const { buildingOps, unitOps, priceOps } = partitionOperations(input.operations);
  const projectOp = input.operations.find((operation) => operation.entity === "project")!;
  const slug = input.manifest.project_slug;

  const findings: CollisionFinding[] = [];

  // ----- Project phase -------------------------------------------------------
  const projectRead = await safeRead(
    () => input.reader.readProjectRows(slug),
    "project_read_failed",
  );
  const projectResolution: ProjectResolution = projectRead.ok
    ? resolveProject(projectRead.value, slug)
    : { kind: "error", code: projectRead.code };

  const projectId = projectResolution.kind === "single" ? projectResolution.row.id : null;

  // Dependencies are independent prerequisites. They must be inspected even
  // when the project anchor is absent, otherwise a new-project preflight can
  // incorrectly report readiness while PostgreSQL will reject the import.
  let projectDependencyError: string | null = null;
  let expectedDeveloperId: string | null = null;
  let expectedLocationId: string | null = null;

  const developerSlug = developerNaturalKey(input.manifest);
  const locationSlug = locationNaturalKey(input.manifest);
  const developerRead = await safeRead(
    () => input.reader.readDeveloperRows(developerSlug),
    "dependency_read_failed",
  );
  const locationRead = await safeRead(
    () => input.reader.readLocationRows(locationSlug),
    "dependency_read_failed",
  );
  const developer = resolveDependency("developer", developerSlug, developerRead);
  const location = resolveDependency("location", locationSlug, locationRead);
  const dependencies = [
    dependencyFinding("developer", developerSlug, developerRead, developer),
    dependencyFinding("location", locationSlug, locationRead, location),
  ];
  if (developer.error || location.error) {
    projectDependencyError = diagnostic(
      [developer.error, location.error].filter(isNonEmptyString),
    );
  } else {
    expectedDeveloperId = developer.id;
    expectedLocationId = location.id;
  }

  findings.push(
    classifyProject(
      projectOp,
      input,
      projectResolution,
      projectDependencyError,
      expectedDeveloperId,
      expectedLocationId,
    ),
  );

  // ----- Building phase ------------------------------------------------------
  const plannedBuildingCodes = [...new Set(buildingOps.map((op) => op.payload.buildingCode))];
  let buildingValidation = emptyKeyed<TargetBuildingRow>();
  const buildingIdByCode = new Map<string, string>();
  let buildingError: string | null = null;

  if (projectId && (buildingOps.length || unitOps.length)) {
    const buildingRead = await safeRead(
      () => input.reader.readBuildingRows(projectId, plannedBuildingCodes),
      "building_read_failed",
    );
    if (!buildingRead.ok) {
      buildingError = buildingRead.code;
    } else {
      buildingValidation = validateBuildingRows(buildingRead.value, projectId);
      for (const [code, rows] of buildingValidation.validByKey) {
        if (rows.length === 1) buildingIdByCode.set(code, rows[0].id);
      }
    }
  }

  for (const operation of buildingOps) {
    findings.push(
      classifyBuilding(operation, projectResolution, buildingError, buildingValidation, projectId),
    );
  }

  // ----- Unit phase ----------------------------------------------------------
  const plannedUnitCodes = [
    ...new Set([
      ...unitOps.map((op) => op.payload.unitNumber),
      ...priceOps.map((op) => op.payload.unitNumber),
    ]),
  ];
  let unitValidation = emptyKeyed<TargetUnitRow>();
  // Unit parent-identity depends on the building set, so a building read error
  // poisons units too.
  let unitError: string | null = buildingError;

  if (projectId && plannedUnitCodes.length && !unitError) {
    const unitRead = await safeRead(
      () => input.reader.readUnitRows(projectId, plannedUnitCodes),
      "unit_read_failed",
    );
    if (!unitRead.ok) {
      unitError = unitRead.code;
    } else {
      unitValidation = validateUnitRows(unitRead.value, projectId);
    }
  }

  for (const operation of unitOps) {
    findings.push(
      classifyUnit(
        operation,
        projectResolution,
        unitError,
        unitValidation,
        buildingIdByCode,
        projectId,
      ),
    );
  }

  // ----- Price-history phase -------------------------------------------------
  const resolvedUnitIdByCode = new Map<string, string>();
  for (const [code, rows] of unitValidation.validByKey) {
    if (rows.length === 1) resolvedUnitIdByCode.set(code, rows[0].id);
  }
  const resolvedUnitIds = new Set(resolvedUnitIdByCode.values());

  let priceValidation = emptyPriceValidation();
  let priceError: string | null = unitError;

  if (projectId && priceOps.length && !priceError) {
    const referencedUnitIds = new Set<string>();
    for (const operation of priceOps) {
      const unitId = resolvedUnitIdByCode.get(operation.payload.unitNumber);
      if (unitId) referencedUnitIds.add(unitId);
    }

    const priceRead = await safeRead(
      () => input.reader.readPriceHistoryRows([...referencedUnitIds]),
      "price_history_read_failed",
    );
    if (!priceRead.ok) {
      priceError = priceRead.code;
    } else {
      priceValidation = validatePriceRows(priceRead.value, resolvedUnitIds);
    }
  }

  for (const operation of priceOps) {
    findings.push(
      classifyPrice(
        operation,
        projectResolution,
        priceError,
        resolvedUnitIdByCode,
        unitValidation,
        priceValidation,
      ),
    );
  }

  return buildReport(input, findings, null, dependencies);
}

// ---------------------------------------------------------------------------
// Project resolution & dependencies
// ---------------------------------------------------------------------------

type ProjectResolution =
  | { kind: "absent" }
  | { kind: "single"; row: TargetProjectRow }
  | { kind: "duplicate"; count: number }
  | { kind: "malformed"; detail: string }
  | { kind: "error"; code: string };

function resolveProject(rows: TargetProjectRow[], slug: string): ProjectResolution {
  const codes = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      codes.add("malformed_row");
      continue;
    }
    if (!isNonEmptyString(row.id)) codes.add("missing_id");
    if (!isNonEmptyString(row.slug)) codes.add("missing_slug");
    else if (row.slug !== slug) codes.add("slug_mismatch");
    for (const code of fieldShapeErrorCodes(
      PROJECT_FIELDS,
      row as unknown as Record<string, unknown>,
    )) {
      codes.add(code);
    }
  }

  if (codes.size > 0) return { kind: "malformed", detail: diagnostic(codes) };
  if (rows.length === 0) return { kind: "absent" };
  if (rows.length > 1) return { kind: "duplicate", count: rows.length };
  return { kind: "single", row: rows[0] };
}

function resolveDependency(
  label: string,
  expectedSlug: string,
  read: PhaseResult<TargetDeveloperRow[] | TargetLocationRow[]>,
): { id: string; error: null } | { id: null; error: string } {
  if (!read.ok) return { id: null, error: `${label}:${read.code}` };
  const rows = read.value;
  if (rows.length === 0) return { id: null, error: `${label}:dependency_absent` };
  if (rows.length > 1) return { id: null, error: `${label}:dependency_duplicate` };
  const row = rows[0];
  if (!row || typeof row !== "object") return { id: null, error: `${label}:malformed_row` };
  if (!isNonEmptyString(row.id)) return { id: null, error: `${label}:missing_id` };
  if (!isNonEmptyString(row.slug)) return { id: null, error: `${label}:missing_slug` };
  if (row.slug !== expectedSlug) return { id: null, error: `${label}:slug_mismatch` };
  return { id: row.id, error: null };
}

function dependencyFinding(
  dependency: "developer" | "location",
  naturalKey: string,
  read: PhaseResult<TargetDeveloperRow[] | TargetLocationRow[]>,
  resolution: ReturnType<typeof resolveDependency>,
): DependencyFinding {
  if (!read.ok) {
    return { dependency, naturalKey, classification: "inspection_error", targetRowCount: 0, blocking: true, detail: read.code };
  }
  const rows = read.value;
  if (rows.length === 0) {
    return { dependency, naturalKey, classification: "absent", targetRowCount: 0, blocking: true, detail: "dependency_absent" };
  }
  if (rows.length > 1) {
    return { dependency, naturalKey, classification: "ambiguous", targetRowCount: rows.length, blocking: true, detail: "dependency_duplicate" };
  }
  const row = rows[0];
  if (!row || typeof row !== "object" || !isNonEmptyString(row.id) || !isNonEmptyString(row.slug)) {
    return { dependency, naturalKey, classification: "invalid_or_null_natural_key", targetRowCount: 1, blocking: true, detail: resolution.error ?? "invalid_dependency_row" };
  }
  if (row.slug !== naturalKey) {
    return { dependency, naturalKey, classification: "identity_conflict", targetRowCount: 1, blocking: true, detail: "slug_mismatch" };
  }
  return { dependency, naturalKey, classification: "present_exactly_once", targetRowCount: 1, blocking: false, detail: "exact_natural_key" };
}

// ---------------------------------------------------------------------------
// Row validators
// ---------------------------------------------------------------------------

function validateBuildingRows(
  rows: TargetBuildingRow[],
  projectId: string,
): KeyedValidation<TargetBuildingRow> {
  const result = emptyKeyed<TargetBuildingRow>();
  for (const row of rows) {
    const code = row.building_code;
    if (!isNonEmptyString(code)) {
      result.structuralErrors.add("missing_building_code");
      continue;
    }
    const codes: string[] = [];
    if (!isNonEmptyString(row.id)) codes.push("missing_id");
    if (!isNonEmptyString(row.project_id) || row.project_id !== projectId)
      codes.push("wrong_project");
    codes.push(...fieldShapeErrorCodes(BUILDING_FIELDS, row as unknown as Record<string, unknown>));
    if (codes.length) {
      addKeyedErrors(result, code, codes);
      continue;
    }
    pushValid(result.validByKey, code, row);
  }
  return result;
}

function validateUnitRows(
  rows: TargetUnitRow[],
  projectId: string,
): KeyedValidation<TargetUnitRow> {
  const result = emptyKeyed<TargetUnitRow>();
  for (const row of rows) {
    const code = row.unit_code;
    if (!isNonEmptyString(code)) {
      result.structuralErrors.add("missing_unit_code");
      continue;
    }
    const codes: string[] = [];
    if (!isNonEmptyString(row.id)) codes.push("missing_id");
    if (!isNonEmptyString(row.project_id) || row.project_id !== projectId)
      codes.push("wrong_project");
    if (
      row.building_id !== null &&
      row.building_id !== undefined &&
      !isNonEmptyString(row.building_id)
    ) {
      codes.push("invalid_building_id");
    }
    codes.push(...fieldShapeErrorCodes(UNIT_FIELDS, row as unknown as Record<string, unknown>));
    if (codes.length) {
      addKeyedErrors(result, code, codes);
      continue;
    }
    pushValid(result.validByKey, code, row);
  }
  return result;
}

/**
 * Canonical target-side persistence identity for one price-history row,
 * mirroring the database dedupe key `(unit_id, price_source, source_file,
 * source_page, price_list_date)`. `sourceRow` is intentionally excluded —
 * it is not part of the database persistence key. Components are coerced so
 * the plan side and the target side always produce identical keys.
 */
function priceTargetPersistenceKey(
  unitId: string,
  priceSource: unknown,
  sourceFile: unknown,
  sourcePage: unknown,
  priceListDate: unknown,
): string {
  return JSON.stringify([
    unitId,
    priceSource === null || priceSource === undefined ? null : String(priceSource),
    sourceFile === null || sourceFile === undefined ? null : String(sourceFile),
    sourcePage === null || sourcePage === undefined ? null : Number(sourcePage),
    normalizeDate(priceListDate),
  ]);
}

/**
 * Price-history validation output. Malformed rows are never dropped: a
 * malformed row whose persistence-key fields are still establishable is
 * recorded against that exact key; a malformed row whose key cannot be
 * established safely is recorded against its parent unit so every operation on
 * that unit fails closed.
 */
interface PriceValidation {
  validByKey: Map<string, TargetPriceHistoryRow[]>;
  malformedByKey: Map<string, Set<string>>;
  malformedByUnitId: Map<string, Set<string>>;
  structuralErrors: Set<string>;
}

function emptyPriceValidation(): PriceValidation {
  return {
    validByKey: new Map(),
    malformedByKey: new Map(),
    malformedByUnitId: new Map(),
    structuralErrors: new Set(),
  };
}

function addSetEntry(map: Map<string, Set<string>>, key: string, codes: string[]): void {
  const bucket = map.get(key) ?? new Set<string>();
  for (const code of codes) bucket.add(code);
  map.set(key, bucket);
}

/** True when every persistence-key field of the row has a usable shape. */
function priceKeyEstablishable(row: TargetPriceHistoryRow): boolean {
  return (
    isNonEmptyString(row.price_source) &&
    (row.source_file === null ||
      row.source_file === undefined ||
      typeof row.source_file === "string") &&
    validFieldShape("number", row.source_page) &&
    (row.price_list_date === null ||
      row.price_list_date === undefined ||
      typeof row.price_list_date === "string")
  );
}

function validatePriceRows(
  rows: TargetPriceHistoryRow[],
  resolvedUnitIds: Set<string>,
): PriceValidation {
  const result = emptyPriceValidation();
  for (const row of rows) {
    if (!isNonEmptyString(row.unit_id) || !resolvedUnitIds.has(row.unit_id)) {
      result.structuralErrors.add("foreign_unit");
      continue;
    }
    const codes: string[] = [];
    if (!isNonEmptyString(row.id)) codes.push("missing_id");
    if (!isNonEmptyString(row.price_source)) codes.push("missing_price_source");
    codes.push(...fieldShapeErrorCodes(PRICE_FIELDS, row as unknown as Record<string, unknown>));

    if (codes.length === 0) {
      pushValid(
        result.validByKey,
        priceTargetPersistenceKey(
          row.unit_id,
          row.price_source,
          row.source_file,
          row.source_page,
          row.price_list_date,
        ),
        row,
      );
      continue;
    }

    // Malformed row: never dropped. Attach it to its persistence key when that
    // key is establishable; otherwise fail closed for the whole parent unit
    // because the row cannot be proven unrelated to any operation on it.
    if (priceKeyEstablishable(row)) {
      addSetEntry(
        result.malformedByKey,
        priceTargetPersistenceKey(
          row.unit_id,
          row.price_source,
          row.source_file,
          row.source_page,
          row.price_list_date,
        ),
        codes,
      );
    } else {
      addSetEntry(result.malformedByUnitId, row.unit_id, [
        ...codes,
        "persistence_key_unresolvable",
      ]);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Classifiers
// ---------------------------------------------------------------------------

function classifyProject(
  operation: ImportOperation,
  input: InspectPlanCollisionsInput,
  resolution: ProjectResolution,
  dependencyError: string | null,
  developerId: string | null,
  locationId: string | null,
): CollisionFinding {
  switch (resolution.kind) {
    case "error":
      return finding("project", operation, "inspection_error", 0, resolution.code);
    case "malformed":
      return finding("project", operation, "inspection_error", 0, resolution.detail);
    case "absent":
      return finding("project", operation, "absent", 0, "no_target_row");
    case "duplicate":
      return finding(
        "project",
        operation,
        "duplicate_target_rows",
        resolution.count,
        "duplicate_target_rows",
      );
    case "single": {
      if (dependencyError || developerId === null || locationId === null) {
        return finding(
          "project",
          operation,
          "inspection_error",
          1,
          dependencyError ?? "dependency_unresolved",
        );
      }
      const expected = projectPersistenceProjection(input.manifest, { developerId, locationId });
      const changed = changedFieldsFor(
        PROJECT_FIELDS,
        expected,
        resolution.row as unknown as Record<string, unknown>,
      );
      return changed.length === 0
        ? finding("project", operation, "exact_match", 1, "exact_match")
        : finding("project", operation, "update_required", 1, "fields_would_change", changed);
    }
  }
}

function unresolvedParentFinding(
  entity: ImportEntityType,
  operation: ImportOperation,
  resolution: ProjectResolution,
): CollisionFinding | null {
  switch (resolution.kind) {
    case "absent":
      return finding(entity, operation, "absent", 0, "parent_project_absent");
    case "duplicate":
      return finding(entity, operation, "inspection_error", 0, "parent_project_ambiguous");
    case "malformed":
      return finding(entity, operation, "inspection_error", 0, "parent_project_malformed");
    case "error":
      return finding(entity, operation, "inspection_error", 0, resolution.code);
    case "single":
      return null;
  }
}

function classifyBuilding(
  operation: ImportOperation<BuildingInput>,
  resolution: ProjectResolution,
  buildingError: string | null,
  validation: KeyedValidation<TargetBuildingRow>,
  projectId: string | null,
): CollisionFinding {
  const unresolved = unresolvedParentFinding("building", operation, resolution);
  if (unresolved) return unresolved;
  if (buildingError) return finding("building", operation, "inspection_error", 0, buildingError);
  if (validation.structuralErrors.size) {
    return finding(
      "building",
      operation,
      "inspection_error",
      0,
      diagnostic(validation.structuralErrors),
    );
  }

  const code = operation.payload.buildingCode;
  const keyed = validation.keyedErrors.get(code);
  if (keyed) return finding("building", operation, "inspection_error", 0, diagnostic(keyed));

  const matches = validation.validByKey.get(code) ?? [];
  if (matches.length === 0) return finding("building", operation, "absent", 0, "no_target_row");
  if (matches.length > 1) {
    return finding(
      "building",
      operation,
      "duplicate_target_rows",
      matches.length,
      "duplicate_target_rows",
    );
  }

  const expected = buildingPersistenceProjection(projectId as string, operation.payload);
  const changed = changedFieldsFor(
    BUILDING_FIELDS,
    expected,
    matches[0] as unknown as Record<string, unknown>,
  );
  return changed.length === 0
    ? finding("building", operation, "exact_match", 1, "exact_match")
    : finding("building", operation, "update_required", 1, "fields_would_change", changed);
}

function classifyUnit(
  operation: ImportOperation<UnitInput>,
  resolution: ProjectResolution,
  unitError: string | null,
  validation: KeyedValidation<TargetUnitRow>,
  buildingIdByCode: Map<string, string>,
  projectId: string | null,
): CollisionFinding {
  const unresolved = unresolvedParentFinding("unit", operation, resolution);
  if (unresolved) return unresolved;
  if (unitError) return finding("unit", operation, "inspection_error", 0, unitError);
  if (validation.structuralErrors.size) {
    return finding(
      "unit",
      operation,
      "inspection_error",
      0,
      diagnostic(validation.structuralErrors),
    );
  }

  const code = operation.payload.unitNumber;
  const keyed = validation.keyedErrors.get(code);
  if (keyed) return finding("unit", operation, "inspection_error", 0, diagnostic(keyed));

  const matches = validation.validByKey.get(code) ?? [];
  if (matches.length === 0) return finding("unit", operation, "absent", 0, "no_target_row");
  if (matches.length > 1) {
    return finding(
      "unit",
      operation,
      "duplicate_target_rows",
      matches.length,
      "duplicate_target_rows",
    );
  }

  const row = matches[0];
  const expectedBuildingCode = operation.payload.buildingCode ?? null;
  let expectedBuildingId: string | null = null;

  if (expectedBuildingCode !== null) {
    const resolvedBuildingId = buildingIdByCode.get(expectedBuildingCode);
    if (resolvedBuildingId === undefined) {
      // Expected parent building identity cannot be resolved deterministically.
      return finding("unit", operation, "identity_conflict", 1, "unresolved_parent_building");
    }
    expectedBuildingId = resolvedBuildingId;
    if (isNonEmptyString(row.building_id) && row.building_id !== resolvedBuildingId) {
      return finding("unit", operation, "identity_conflict", 1, "building_parent_mismatch");
    }
  }

  const expected = unitPersistenceProjection(
    projectId as string,
    expectedBuildingId,
    operation.payload,
  );
  const changed = changedFieldsFor(
    UNIT_FIELDS,
    expected,
    row as unknown as Record<string, unknown>,
  );
  return changed.length === 0
    ? finding("unit", operation, "exact_match", 1, "exact_match")
    : finding("unit", operation, "update_required", 1, "fields_would_change", changed);
}

function classifyPrice(
  operation: ImportOperation<PriceHistoryInput>,
  resolution: ProjectResolution,
  priceError: string | null,
  resolvedUnitIdByCode: Map<string, string>,
  unitValidation: KeyedValidation<TargetUnitRow>,
  priceValidation: PriceValidation,
): CollisionFinding {
  const unresolved = unresolvedParentFinding("unit_price_history", operation, resolution);
  if (unresolved) return unresolved;
  if (priceError)
    return finding("unit_price_history", operation, "inspection_error", 0, priceError);
  if (priceValidation.structuralErrors.size) {
    return finding(
      "unit_price_history",
      operation,
      "inspection_error",
      0,
      diagnostic(priceValidation.structuralErrors),
    );
  }
  if (unitValidation.structuralErrors.size) {
    return finding(
      "unit_price_history",
      operation,
      "inspection_error",
      0,
      diagnostic(unitValidation.structuralErrors),
    );
  }

  const unitCode = operation.payload.unitNumber;
  if (unitValidation.keyedErrors.has(unitCode)) {
    return finding("unit_price_history", operation, "inspection_error", 0, "parent_unit_malformed");
  }
  const unitMatches = unitValidation.validByKey.get(unitCode) ?? [];
  if (unitMatches.length === 0) {
    return finding("unit_price_history", operation, "absent", 0, "parent_unit_absent");
  }
  if (unitMatches.length > 1) {
    return finding("unit_price_history", operation, "inspection_error", 0, "parent_unit_ambiguous");
  }

  const unitId = resolvedUnitIdByCode.get(unitCode);
  if (!unitId) {
    return finding(
      "unit_price_history",
      operation,
      "inspection_error",
      0,
      "parent_unit_unresolved",
    );
  }

  // Fail closed on malformed target rows BEFORE any non-error classification.
  // A malformed row whose persistence-key fields could not be established may
  // collide with any operation on this unit.
  const unitMalformed = priceValidation.malformedByUnitId.get(unitId);
  if (unitMalformed) {
    return finding(
      "unit_price_history",
      operation,
      "inspection_error",
      0,
      diagnostic(unitMalformed),
    );
  }

  const operationKey = priceTargetPersistenceKey(
    unitId,
    operation.payload.priceSource,
    operation.payload.sourceFile ?? null,
    operation.payload.sourcePage ?? null,
    operation.payload.priceListDate ?? null,
  );

  // A malformed row that maps to this exact persistence identity blocks the
  // operation even when a valid row with the same identity also exists — the
  // target state is ambiguous or corrupted, never `absent` or `exact_match`.
  const keyMalformed = priceValidation.malformedByKey.get(operationKey);
  if (keyMalformed) {
    return finding(
      "unit_price_history",
      operation,
      "inspection_error",
      0,
      diagnostic(keyMalformed),
    );
  }

  const candidates = priceValidation.validByKey.get(operationKey) ?? [];
  if (candidates.length === 0) {
    return finding("unit_price_history", operation, "absent", 0, "no_target_row");
  }
  if (candidates.length > 1) {
    return finding(
      "unit_price_history",
      operation,
      "duplicate_target_rows",
      candidates.length,
      "duplicate_target_rows",
    );
  }

  const expected = priceHistoryPersistenceProjection(unitId, operation.payload);
  const changed = changedFieldsFor(
    PRICE_FIELDS,
    expected,
    candidates[0] as unknown as Record<string, unknown>,
  );
  return changed.length === 0
    ? finding("unit_price_history", operation, "exact_match", 1, "exact_match")
    : finding(
        "unit_price_history",
        operation,
        "update_required",
        1,
        "fields_would_change",
        changed,
      );
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

function buildReport(
  input: InspectPlanCollisionsInput,
  rawFindings: CollisionFinding[],
  operationSetError: string | null,
  dependencies: DependencyFinding[] = [],
): CollisionInspectionReport {
  if (rawFindings.length !== input.operations.length) {
    throw new Error(
      `Collision inspector produced ${rawFindings.length} findings for ${input.operations.length} operations.`,
    );
  }

  const findings = [...rawFindings].sort((left, right) => {
    const entityDelta = ENTITY_ORDER[left.entity] - ENTITY_ORDER[right.entity];
    if (entityDelta !== 0) return entityDelta;
    if (left.naturalKey < right.naturalKey) return -1;
    if (left.naturalKey > right.naturalKey) return 1;
    return 0;
  });

  const countsByClassification = COLLISION_CLASSIFICATIONS.reduce(
    (counts, classification) => {
      counts[classification] = 0;
      return counts;
    },
    {} as Record<CollisionClassification, number>,
  );
  for (const item of findings) {
    countsByClassification[item.classification] += 1;
  }

  const blockingFindings = findings.filter((item) => item.blocking);
  const hasChanges = findings.some(
    (item) => item.classification === "absent" || item.classification === "update_required",
  );
  const prerequisitesStatus: PrerequisitesStatus = dependencies.some((item) => item.classification !== "present_exactly_once")
    ? dependencies.some((item) => item.classification !== "absent" && item.classification !== "present_exactly_once")
      ? "blocked"
      : "missing"
    : "ready";
  const status: CollisionInspectionStatus = blockingFindings.length || prerequisitesStatus !== "ready"
    ? "blocked"
    : hasChanges
      ? "changes_detected"
      : "clean";

  return {
    schemaVersion: COLLISION_REPORT_SCHEMA_VERSION,
    projectSlug: input.manifest.project_slug,
    approvedTarget: input.target,
    targetIdentity: { projectId: input.targetIdentity.projectId ?? "" },
    planHash: input.planHash,
    shortPlanHash: input.shortPlanHash,
    sourceVersion: input.sourceVersion,
    operationCounts: input.operationCounts,
    totalInspectedOperations: findings.length,
    countsByClassification,
    findings,
    blockingFindings,
    dependencies,
    prerequisitesStatus,
    projectAnchorStatus:
      projectResolutionStatus(input, findings, prerequisitesStatus),
    operationSetError,
    readOnlyConfirmed: true,
    executeEnabled: false,
    writesPerformed: 0,
    status,
  };
}

function projectResolutionStatus(
  input: InspectPlanCollisionsInput,
  findings: CollisionFinding[],
  prerequisitesStatus: PrerequisitesStatus,
): CollisionInspectionReport["projectAnchorStatus"] {
  const project = findings.find((item) => item.entity === "project" && item.naturalKey === input.manifest.project_slug);
  if (!project || project.classification === "inspection_error" || project.classification === "duplicate_target_rows" || project.classification === "identity_conflict") return "blocked";
  if (project.classification !== "absent") return "present";
  return prerequisitesStatus === "ready" ? "absent_prerequisites_ready" : "absent_prerequisites_missing";
}

// ---------------------------------------------------------------------------
// RC5.5C shared surfaces
// ---------------------------------------------------------------------------

/**
 * Deterministic SHA-256 fingerprint of a collision report. The report itself
 * contains no timestamps or volatile values, so the fingerprint is stable for
 * identical inspections and binds an Owner execution approval to the exact
 * inspected target state.
 */
export function fingerprintCollisionReport(report: CollisionInspectionReport): string {
  return createHash("sha256").update(canonicalJsonString(report)).digest("hex");
}

const COMPARABLE_FIELDS_BY_ENTITY: Partial<Record<ImportEntityType, ComparableField[]>> = {
  project: PROJECT_FIELDS,
  building: BUILDING_FIELDS,
  unit: UNIT_FIELDS,
  unit_price_history: PRICE_FIELDS,
};

/**
 * Compares an expected persistence projection against a persisted row using
 * the exact stable-field contract of the collision inspector. Returns the
 * sorted list of differing fields. Shared with the RC5.5C in-transaction
 * verification step so the inspector and the execution path can never drift.
 */
export function comparePersistedEntityFields(
  entity: ImportEntityType,
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): string[] {
  const fields = COMPARABLE_FIELDS_BY_ENTITY[entity];
  if (!fields) return ["entity_not_comparable"];
  return changedFieldsFor(fields, expected, actual);
}

/** Canonical execution order index per entity (dependencies before children). */
export const IMPORT_ENTITY_EXECUTION_ORDER: Readonly<Record<ImportEntityType, number>> =
  ENTITY_ORDER;
