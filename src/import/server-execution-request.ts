import { createHash } from "node:crypto";

import type { BuildingInput, PriceHistoryInput, UnitInput } from "./database";
import type { ImportOperationCounts } from "./plan-hash";
import type { ImportOperation } from "./types";
import { validateImportOperationSet } from "./collision-inspector";
import {
  buildingPersistenceProjection,
  canonicalJson,
  canonicalJsonString,
  developerNaturalKey,
  locationNaturalKey,
  priceHistoryPersistenceProjection,
  projectPersistenceProjection,
  unitPersistenceProjection,
  type ProjectManifestFields,
} from "./persistence-projection";
import { validateExecutionOrdering } from "./transaction-executor";

/**
 * RC5.5D typed, versioned server execution request.
 *
 * This is the ONLY payload the future live path may send to the server-side
 * transaction boundary (`public.forever_execute_approved_import`). It is
 * bounded to one approved plan and carries exclusively the stable data the
 * server needs: non-secret identifiers, digests, exact operation counts, and
 * the entity rows produced by the SHARED RC5.5B/RC5.5C persistence
 * projections with relational ids replaced by natural keys (the server
 * resolves ids inside its transaction). There is deliberately no free-form
 * metadata expansion, no source document, no local path, no credential, no
 * SQL, and no volatile runtime field — the request fingerprint is stable for
 * an identical approved plan.
 */

export const SERVER_EXECUTION_REQUEST_SCHEMA_VERSION = "1" as const;

/**
 * Fully-qualified name of the single server-side execution boundary function,
 * in its dedicated closed schema (never `public`, never PostgREST).
 */
export const APPROVED_IMPORT_EXECUTION_FUNCTION =
  "forever_execution.forever_execute_approved_import" as const;

/**
 * The ONE fixed, parameterized statement the direct-PostgreSQL transport may
 * run. The caller supplies only the request as the single bound `$1::jsonb`
 * parameter — never a schema, table, function name, or any other SQL.
 */
export const APPROVED_IMPORT_EXECUTION_STATEMENT =
  "SELECT forever_execution.forever_execute_approved_import($1::jsonb)" as const;

/** Hard operation ceiling; mirrors the migration's server-side bound. */
export const MAX_SERVER_EXECUTION_OPERATIONS = 1000;

/** Hard canonical-payload byte ceiling; mirrors the migration's size bound. */
export const MAX_SERVER_EXECUTION_REQUEST_BYTES = 4_000_000;

/** Domain-separation prefix for server-request fingerprints. */
export const SERVER_REQUEST_FINGERPRINT_DOMAIN = "forever-import-server-request:v1" as const;

const PROJECT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TARGET_PATTERN = /^[a-z][a-z-]{0,31}$/;
const TARGET_PROJECT_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/;

/** Exact top-level key set (sorted), mirrored by the migration. */
export const SERVER_REQUEST_KEYS = [
  "approvalDigest",
  "collisionReportFingerprint",
  "entities",
  "operationCounts",
  "planHash",
  "projectSlug",
  "requestFingerprint",
  "schemaVersion",
  "target",
  "targetProjectId",
] as const;

export const SERVER_ENTITY_KEYS = ["buildings", "priceHistory", "project", "units"] as const;

export const SERVER_PROJECT_KEYS = [
  "address",
  "developer_slug",
  "full_description",
  "is_active",
  "location_area",
  "location_slug",
  "name",
  "project_code",
  "project_type",
  "public_status",
  "sales_status",
  "short_description",
  "slug",
] as const;

export const SERVER_BUILDING_KEYS = [
  "building_code",
  "building_type",
  "floors_count",
  "metadata",
  "name",
  "units_count",
] as const;

export const SERVER_UNIT_KEYS = [
  "availability_status",
  "base_price_thb",
  "bathrooms",
  "bedrooms",
  "building_code",
  "floor",
  "metadata",
  "price_per_sqm",
  "size_sqm",
  "unit_code",
  "unit_status",
  "unit_type",
] as const;

export const SERVER_PRICE_HISTORY_KEYS = [
  "currency",
  "metadata",
  "price",
  "price_list_date",
  "price_source",
  "recorded_at",
  "source_file",
  "source_page",
  "unit_code",
] as const;

export const OPERATION_COUNT_KEYS = [
  "buildings",
  "operations",
  "priceHistoryRows",
  "projects",
  "units",
] as const;

export interface ServerProjectEntity {
  slug: string;
  name: string;
  developer_slug: string;
  location_slug: string;
  project_code: string;
  project_type: string;
  location_area: string;
  address: string;
  short_description: string;
  full_description: string;
  is_active: boolean;
  public_status: string;
  sales_status: string;
}

export interface ServerBuildingEntity {
  building_code: string;
  name: string;
  building_type: string;
  floors_count: number | null;
  units_count: number | null;
  metadata: Record<string, unknown>;
}

export interface ServerUnitEntity {
  unit_code: string;
  building_code: string | null;
  unit_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  size_sqm: number | null;
  floor: number | null;
  base_price_thb: number | null;
  price_per_sqm: number | null;
  availability_status: string;
  unit_status: string;
  metadata: Record<string, unknown>;
}

export interface ServerPriceHistoryEntity {
  unit_code: string;
  price: number;
  currency: string;
  price_source: string;
  source_file: string | null;
  source_page: number | null;
  price_list_date: string | null;
  recorded_at: string;
  metadata: Record<string, unknown>;
}

export interface ServerExecutionRequest {
  schemaVersion: typeof SERVER_EXECUTION_REQUEST_SCHEMA_VERSION;
  projectSlug: string;
  target: string;
  targetProjectId: string;
  planHash: string;
  collisionReportFingerprint: string;
  /** Domain-separated digest only — never a raw approval id. */
  approvalDigest: string;
  /** Deterministic fingerprint of every other field of this request. */
  requestFingerprint: string;
  operationCounts: ImportOperationCounts;
  entities: {
    project: ServerProjectEntity;
    buildings: ServerBuildingEntity[];
    units: ServerUnitEntity[];
    priceHistory: ServerPriceHistoryEntity[];
  };
}

export type ServerRequestValidationCode =
  | "request_malformed"
  | "request_too_large"
  | "request_schema_unsupported"
  | "request_unsupported_property"
  | "request_invalid_field"
  | "request_operation_counts_invalid"
  | "request_operation_count_exceeded"
  | "request_duplicate_natural_key"
  | "request_duplicate_persistence_key"
  | "request_missing_parent_reference"
  | "request_unsafe_path"
  | "request_credential_material"
  | "request_fingerprint_mismatch";

// ---------------------------------------------------------------------------
// Canonical representation and fingerprint
// ---------------------------------------------------------------------------

/**
 * Deterministic canonical JSON text of a server request: undefined dropped,
 * object keys sorted, array order preserved. Two structurally identical
 * requests always serialize to identical bytes.
 */
export function canonicalServerExecutionRequest(request: unknown): string {
  return canonicalJsonString(request);
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Deterministic, domain-separated SHA-256 fingerprint over every request
 * field EXCEPT `requestFingerprint` itself. Contains no volatile runtime
 * fields (no timestamps, no random ids), so an identical approved plan always
 * fingerprints identically.
 */
export function fingerprintServerExecutionRequest(request: Record<string, unknown>): string {
  const { requestFingerprint: _omitted, ...rest } = request;
  return createHash("sha256")
    .update(`${SERVER_REQUEST_FINGERPRINT_DOMAIN}:${canonicalJsonString(rest)}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Validation (fail closed; deterministic stable codes)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value: unknown): boolean {
  return value === null || isFiniteNumber(value);
}

/**
 * True when a source-file value is a bare file name: no POSIX or Windows path
 * separator and no drive prefix, so no raw local path can enter the request.
 */
export function isSafeSourceFileName(value: string): boolean {
  return !value.includes("/") && !value.includes("\\") && !/^[A-Za-z]:/.test(value);
}

/** Substrings that indicate credential material; none may appear anywhere. */
const CREDENTIAL_MARKERS = [
  "sb_secret_",
  "sb_publishable_",
  "eyJhbGciOi",
  "postgres://",
  "postgresql://",
  "Bearer ",
  "SUPABASE_",
] as const;

function containsCredentialMaterial(value: unknown): boolean {
  if (typeof value === "string") {
    return CREDENTIAL_MARKERS.some((marker) => value.includes(marker));
  }
  if (Array.isArray(value)) return value.some(containsCredentialMaterial);
  if (isPlainObject(value)) {
    return Object.entries(value).some(
      ([key, entry]) => containsCredentialMaterial(key) || containsCredentialMaterial(entry),
    );
  }
  return false;
}

/** True when any `source_file` property at any depth carries a raw path. */
function containsUnsafeSourceFile(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUnsafeSourceFile);
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, entry]) => {
    if (key === "source_file" && typeof entry === "string" && !isSafeSourceFileName(entry)) {
      return true;
    }
    return containsUnsafeSourceFile(entry);
  });
}

function validateOperationCounts(candidate: unknown): ServerRequestValidationCode | null {
  if (!isPlainObject(candidate) || !hasExactKeys(candidate, OPERATION_COUNT_KEYS)) {
    return "request_operation_counts_invalid";
  }
  for (const key of OPERATION_COUNT_KEYS) {
    const value = candidate[key];
    if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 0) {
      return "request_operation_counts_invalid";
    }
  }
  const counts = candidate as unknown as ImportOperationCounts;
  if (counts.projects !== 1) return "request_operation_counts_invalid";
  if (
    counts.operations !==
    counts.projects + counts.buildings + counts.units + counts.priceHistoryRows
  ) {
    return "request_operation_counts_invalid";
  }
  if (counts.operations > MAX_SERVER_EXECUTION_OPERATIONS) {
    return "request_operation_count_exceeded";
  }
  return null;
}

function validateProjectEntity(
  candidate: unknown,
  projectSlug: string,
): ServerRequestValidationCode | null {
  if (!isPlainObject(candidate)) return "request_malformed";
  if (!hasExactKeys(candidate, SERVER_PROJECT_KEYS)) return "request_unsupported_property";
  if (
    candidate.slug !== projectSlug ||
    !isString(candidate.name) ||
    !isString(candidate.developer_slug) ||
    !isString(candidate.location_slug) ||
    !isString(candidate.project_code) ||
    !isString(candidate.project_type) ||
    !isString(candidate.location_area) ||
    !isString(candidate.address) ||
    !isString(candidate.short_description) ||
    !isString(candidate.full_description) ||
    typeof candidate.is_active !== "boolean" ||
    !isString(candidate.public_status) ||
    !isString(candidate.sales_status)
  ) {
    return "request_invalid_field";
  }
  return null;
}

function validateBuildingEntity(candidate: unknown): ServerRequestValidationCode | null {
  if (!isPlainObject(candidate)) return "request_malformed";
  if (!hasExactKeys(candidate, SERVER_BUILDING_KEYS)) return "request_unsupported_property";
  if (
    !isString(candidate.building_code) ||
    candidate.building_code.length === 0 ||
    !isString(candidate.name) ||
    !isString(candidate.building_type) ||
    !isNullableNumber(candidate.floors_count) ||
    !isNullableNumber(candidate.units_count) ||
    !isPlainObject(candidate.metadata)
  ) {
    return "request_invalid_field";
  }
  return null;
}

function validateUnitEntity(candidate: unknown): ServerRequestValidationCode | null {
  if (!isPlainObject(candidate)) return "request_malformed";
  if (!hasExactKeys(candidate, SERVER_UNIT_KEYS)) return "request_unsupported_property";
  if (
    !isString(candidate.unit_code) ||
    candidate.unit_code.length === 0 ||
    !isNullableString(candidate.building_code) ||
    !isNullableString(candidate.unit_type) ||
    !isNullableNumber(candidate.bedrooms) ||
    !isNullableNumber(candidate.bathrooms) ||
    !isNullableNumber(candidate.size_sqm) ||
    !isNullableNumber(candidate.floor) ||
    !isNullableNumber(candidate.base_price_thb) ||
    !isNullableNumber(candidate.price_per_sqm) ||
    !isString(candidate.availability_status) ||
    !isString(candidate.unit_status) ||
    !isPlainObject(candidate.metadata)
  ) {
    return "request_invalid_field";
  }
  return null;
}

function validatePriceEntity(candidate: unknown): ServerRequestValidationCode | null {
  if (!isPlainObject(candidate)) return "request_malformed";
  if (!hasExactKeys(candidate, SERVER_PRICE_HISTORY_KEYS)) return "request_unsupported_property";
  if (
    !isString(candidate.unit_code) ||
    candidate.unit_code.length === 0 ||
    !isFiniteNumber(candidate.price) ||
    !isString(candidate.currency) ||
    !isString(candidate.price_source) ||
    !isNullableString(candidate.source_file) ||
    !isNullableNumber(candidate.source_page) ||
    !isNullableString(candidate.price_list_date) ||
    !isString(candidate.recorded_at) ||
    !isPlainObject(candidate.metadata)
  ) {
    return "request_invalid_field";
  }
  if (typeof candidate.source_file === "string" && !isSafeSourceFileName(candidate.source_file)) {
    return "request_unsafe_path";
  }
  return null;
}

function pricePersistenceKey(entity: ServerPriceHistoryEntity): string {
  return JSON.stringify([
    entity.unit_code,
    entity.price_source,
    entity.source_file,
    entity.source_page,
    entity.price_list_date,
  ]);
}

/**
 * Full fail-closed structural validation of a candidate server request.
 * Returns a deterministic stable code, or null when the request is valid.
 * The checks mirror (and strictly contain) the server-side validation in the
 * RC5.5D migration; the server never relies on this client-side pass.
 */
export function validateServerExecutionRequest(
  candidate: unknown,
): ServerRequestValidationCode | null {
  if (!isPlainObject(candidate)) return "request_malformed";
  if (utf8ByteLength(canonicalJsonString(candidate)) > MAX_SERVER_EXECUTION_REQUEST_BYTES) {
    return "request_too_large";
  }
  if (candidate.schemaVersion !== SERVER_EXECUTION_REQUEST_SCHEMA_VERSION) {
    return "request_schema_unsupported";
  }
  if (!hasExactKeys(candidate, SERVER_REQUEST_KEYS)) return "request_unsupported_property";

  if (
    !isString(candidate.projectSlug) ||
    !PROJECT_SLUG_PATTERN.test(candidate.projectSlug) ||
    !isString(candidate.target) ||
    !TARGET_PATTERN.test(candidate.target) ||
    !isString(candidate.targetProjectId) ||
    !TARGET_PROJECT_ID_PATTERN.test(candidate.targetProjectId) ||
    !isString(candidate.planHash) ||
    !HEX_64_PATTERN.test(candidate.planHash) ||
    !isString(candidate.collisionReportFingerprint) ||
    !HEX_64_PATTERN.test(candidate.collisionReportFingerprint) ||
    !isString(candidate.approvalDigest) ||
    !HEX_64_PATTERN.test(candidate.approvalDigest) ||
    !isString(candidate.requestFingerprint) ||
    !HEX_64_PATTERN.test(candidate.requestFingerprint)
  ) {
    return "request_invalid_field";
  }

  const countsError = validateOperationCounts(candidate.operationCounts);
  if (countsError) return countsError;
  const counts = candidate.operationCounts as ImportOperationCounts;

  const entities = candidate.entities;
  if (!isPlainObject(entities)) return "request_malformed";
  if (!hasExactKeys(entities, SERVER_ENTITY_KEYS)) return "request_unsupported_property";
  const { project, buildings, units, priceHistory } = entities;
  if (!Array.isArray(buildings) || !Array.isArray(units) || !Array.isArray(priceHistory)) {
    return "request_malformed";
  }
  if (
    buildings.length !== counts.buildings ||
    units.length !== counts.units ||
    priceHistory.length !== counts.priceHistoryRows
  ) {
    return "request_operation_counts_invalid";
  }

  const projectError = validateProjectEntity(project, candidate.projectSlug);
  if (projectError) return projectError;

  for (const building of buildings) {
    const buildingError = validateBuildingEntity(building);
    if (buildingError) return buildingError;
  }
  const buildingCodes = new Set(
    (buildings as ServerBuildingEntity[]).map((entity) => entity.building_code),
  );
  if (buildingCodes.size !== buildings.length) return "request_duplicate_natural_key";

  for (const unit of units) {
    const unitError = validateUnitEntity(unit);
    if (unitError) return unitError;
  }
  const unitCodes = new Set((units as ServerUnitEntity[]).map((entity) => entity.unit_code));
  if (unitCodes.size !== units.length) return "request_duplicate_natural_key";
  for (const unit of units as ServerUnitEntity[]) {
    if (unit.building_code !== null && !buildingCodes.has(unit.building_code)) {
      return "request_missing_parent_reference";
    }
  }

  const priceKeys = new Set<string>();
  for (const price of priceHistory) {
    const priceError = validatePriceEntity(price);
    if (priceError) return priceError;
    const entity = price as ServerPriceHistoryEntity;
    if (!unitCodes.has(entity.unit_code)) return "request_missing_parent_reference";
    const key = pricePersistenceKey(entity);
    if (priceKeys.has(key)) return "request_duplicate_persistence_key";
    priceKeys.add(key);
  }

  if (containsUnsafeSourceFile(candidate)) return "request_unsafe_path";
  if (containsCredentialMaterial(candidate)) return "request_credential_material";

  if (candidate.requestFingerprint !== fingerprintServerExecutionRequest(candidate)) {
    return "request_fingerprint_mismatch";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Request construction (reuses the shared projections and plan validators)
// ---------------------------------------------------------------------------

export interface BuildServerExecutionRequestInput {
  manifest: ProjectManifestFields;
  operations: ImportOperation[];
  operationCounts: ImportOperationCounts;
  planHash: string;
  target: string;
  targetProjectId: string;
  approvalDigest: string;
  collisionReportFingerprint: string;
}

export type BuildServerExecutionRequestResult =
  | { ok: true; request: ServerExecutionRequest }
  | { ok: false; code: string };

interface PartitionedOperations {
  buildingOps: ImportOperation<BuildingInput>[];
  unitOps: ImportOperation<UnitInput>[];
  priceOps: ImportOperation<PriceHistoryInput>[];
}

function partition(operations: ImportOperation[]): PartitionedOperations {
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

/**
 * Builds the canonical server request for one approved plan by reusing the
 * exact RC5.5B/RC5.5C contracts: the shared operation-set validator, the
 * shared execution-ordering validator, and the shared persistence
 * projections. Relational ids in the projections are replaced with the
 * natural keys the server resolves inside its transaction — this module never
 * introduces a second persistence-mapping implementation. Fails closed with a
 * stable code; a returned request is guaranteed to satisfy
 * {@link validateServerExecutionRequest}.
 */
export function buildServerExecutionRequest(
  input: BuildServerExecutionRequestInput,
): BuildServerExecutionRequestResult {
  const operationSetError = validateImportOperationSet({
    operations: input.operations,
    operationCounts: input.operationCounts,
    manifest: input.manifest,
  });
  if (operationSetError) return { ok: false, code: "operation_set_invalid" };

  const orderingError = validateExecutionOrdering(input.operations);
  if (orderingError) return { ok: false, code: orderingError };

  const { buildingOps, unitOps, priceOps } = partition(input.operations);

  const {
    developer_id: _developerId,
    location_id: _locationId,
    ...projectFields
  } = projectPersistenceProjection(input.manifest, { developerId: "", locationId: "" });
  const project: ServerProjectEntity = {
    ...projectFields,
    developer_slug: developerNaturalKey(input.manifest),
    location_slug: locationNaturalKey(input.manifest),
  };

  const buildings = buildingOps.map((operation): ServerBuildingEntity => {
    const { project_id: _projectId, ...fields } = buildingPersistenceProjection(
      "",
      operation.payload,
    );
    return fields as ServerBuildingEntity;
  });

  const units = unitOps.map((operation): ServerUnitEntity => {
    const buildingCode = operation.payload.buildingCode ?? null;
    const {
      project_id: _projectId,
      building_id: _buildingId,
      ...fields
    } = unitPersistenceProjection("", buildingCode === null ? null : "", operation.payload);
    return { ...fields, building_code: buildingCode } as ServerUnitEntity;
  });

  const priceHistory = priceOps.map((operation): ServerPriceHistoryEntity => {
    const { unit_id: _unitId, ...fields } = priceHistoryPersistenceProjection(
      "",
      operation.payload,
    );
    return { ...fields, unit_code: operation.payload.unitNumber } as ServerPriceHistoryEntity;
  });

  // Canonicalize once (drops undefined, sorts keys) so the object sent, the
  // canonical serialization, and the fingerprint all agree byte for byte.
  const withoutFingerprint = canonicalJson({
    schemaVersion: SERVER_EXECUTION_REQUEST_SCHEMA_VERSION,
    projectSlug: input.manifest.project_slug,
    target: input.target,
    targetProjectId: input.targetProjectId,
    planHash: input.planHash,
    collisionReportFingerprint: input.collisionReportFingerprint,
    approvalDigest: input.approvalDigest,
    operationCounts: input.operationCounts,
    entities: { project, buildings, units, priceHistory },
  }) as Record<string, unknown>;

  const request = {
    ...withoutFingerprint,
    requestFingerprint: fingerprintServerExecutionRequest(withoutFingerprint),
  } as unknown as ServerExecutionRequest;

  const validationError = validateServerExecutionRequest(request);
  if (validationError) return { ok: false, code: validationError };

  return { ok: true, request };
}
