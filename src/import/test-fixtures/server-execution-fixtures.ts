import { createHash } from "node:crypto";

import { canonicalJsonString, slugify } from "../persistence-projection";
import type {
  ApprovedImportDatabaseTransport,
  DatabaseExecutionResponse,
} from "../live-execution-adapter";
import {
  isServerRollbackReasonCode,
  type ServerRollbackReasonCode,
} from "../live-execution-adapter";
import {
  fingerprintServerExecutionRequest,
  validateServerExecutionRequest,
} from "../server-execution-request";
import type {
  ServerBuildingEntity,
  ServerExecutionRequest,
  ServerPriceHistoryEntity,
  ServerUnitEntity,
} from "../server-execution-request";
import { DEVELOPER_ID, LOCATION_ID, MANIFEST } from "./collision-fixtures";

/**
 * Hermetic RC5.5D server fixtures: an in-memory model of the migration's
 * `forever_import.run_approved_import` transaction semantics — durable
 * approval CAS inside the transaction, database-time expiry, fresh-state
 * verification, ordered writes, persisted-row verification, durable receipt,
 * and genuine all-or-nothing atomicity (work runs on a deep clone; only a
 * fully successful run replaces the committed store, so any raise provably
 * leaves ZERO partial durable state, including approvals). Nothing here
 * touches a network, a credential, or a real database.
 */

export const SERVER_DB_NOW = new Date("2026-07-15T12:00:00Z");

export type StoredServerRow = Record<string, unknown> & { id: string };

export interface FakeApprovalRow {
  id: string;
  approval_digest: string;
  schema_version: "1";
  project_slug: string;
  target: string;
  target_project_id: string;
  plan_hash: string;
  collision_report_fingerprint: string;
  operation_count: number;
  /** Immutable canonical approved request body (RC5.5D review blocker 1). */
  approved_request: ServerExecutionRequest;
  /** Digest of the body computed on the SERVER side, never client-supplied. */
  approved_request_digest: string;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
  execution_id: string | null;
}

export interface RegisterApprovalOptions {
  issuedAt?: string;
  expiresAt?: string;
  /** For negative tests that must register a deliberately broken body. */
  skipValidation?: boolean;
}

/**
 * The fake server's internal request digest — the hermetic stand-in for the
 * migration's PostgreSQL-computed `request_digest(jsonb)`. Deliberately
 * self-consistent between registration and execution but never comparable
 * with (and never derived from) the client-side request fingerprint.
 */
export function fakeServerRequestDigest(request: unknown): string {
  return createHash("sha256")
    .update(`fake-forever-import-server:${canonicalJsonString(request)}`)
    .digest("hex");
}

export interface FakeReceiptRow {
  execution_id: string;
  approval_digest: string;
  request_fingerprint: string;
  project_slug: string;
  target: string;
  target_project_id: string;
  plan_hash: string;
  collision_report_fingerprint: string;
  projects_written: number;
  buildings_written: number;
  units_written: number;
  price_history_rows_written: number;
  writes_performed: number;
  outcome: "committed";
}

export interface FakeServerStore {
  developers: Array<{ id: string; slug: string }>;
  locations: Array<{ id: string; slug: string }>;
  projects: StoredServerRow[];
  buildings: StoredServerRow[];
  units: StoredServerRow[];
  priceHistory: StoredServerRow[];
  approvals: FakeApprovalRow[];
  receipts: FakeReceiptRow[];
}

export function seededServerStore(): FakeServerStore {
  return {
    developers: [{ id: DEVELOPER_ID, slug: slugify(MANIFEST.developer) }],
    locations: [{ id: LOCATION_ID, slug: slugify(MANIFEST.location) }],
    projects: [],
    buildings: [],
    units: [],
    priceHistory: [],
    approvals: [],
    receipts: [],
  };
}

class ServerRaise extends Error {
  constructor(public readonly code: ServerRollbackReasonCode) {
    super(`forever_import_execution: ${code}`);
    this.name = "ServerRaise";
  }
}

export interface FakeServerConfig {
  store?: FakeServerStore;
  /** Injectable DATABASE clock used for approval expiry evaluation. */
  dbNow?: () => Date;
  /** Raise this code after exactly N successful writes (mid-transaction). */
  raiseAfterWrites?: { writes: number; code: ServerRollbackReasonCode };
  /** Mutate staged durable state between writes and verification. */
  tamperBeforeVerification?: (staged: FakeServerStore) => void;
  /** Simulate a commit failure AFTER the function body succeeded. */
  commitFails?: boolean;
  /** Respond with this raw provider error instead of running anything. */
  rawError?: unknown;
  /** Respond with this data payload instead of the real result. */
  malformedData?: unknown;
  /** Never resolve (network black hole / timeout). */
  neverResolve?: boolean;
  /** Throw this value at transport level. */
  throwOnCall?: unknown;
}

export class FakeImportExecutionServer {
  public committedStore: FakeServerStore;
  public calls = 0;
  private executionSequence = 0;

  constructor(private readonly config: FakeServerConfig = {}) {
    this.committedStore = config.store ?? seededServerStore();
  }

  private now(): Date {
    return this.config.dbNow ? this.config.dbNow() : SERVER_DB_NOW;
  }

  private nextExecutionId(): string {
    this.executionSequence += 1;
    return `00000000-0000-4000-8000-${String(this.executionSequence).padStart(12, "0")}`;
  }

  /**
   * Mirrors `forever_import.register_import_approval`: receives the COMPLETE
   * bounded approved request, validates it with the same shared validation
   * rules the execution path uses (fail closed on malformed payload,
   * unsupported property, payload/count mismatch, duplicate key, oversized
   * request, unsafe path, credential material), extracts every scope column
   * from the request itself, and stores the immutable body plus a digest
   * computed on the SERVER side — never the client fingerprint.
   */
  registerApproval(request: ServerExecutionRequest, options: RegisterApprovalOptions = {}): void {
    if (!options.skipValidation) {
      const validationError = validateServerExecutionRequest(request);
      if (validationError) {
        throw new ServerRaise(
          isServerRollbackReasonCode(validationError) ? validationError : "request_malformed",
        );
      }
    }
    if (this.committedStore.approvals.some((a) => a.approval_digest === request.approvalDigest)) {
      throw new ServerRaise("approval_already_registered");
    }
    const issuedAt = options.issuedAt ?? new Date(SERVER_DB_NOW.getTime() - 60_000).toISOString();
    const expiresAt =
      options.expiresAt ?? new Date(SERVER_DB_NOW.getTime() + 30 * 60_000).toISOString();
    const issued = Date.parse(issuedAt);
    const expires = Date.parse(expiresAt);
    if (!(expires > issued) || expires - issued > 60 * 60 * 1000) {
      throw new Error("approval_lifetime_invalid");
    }
    this.committedStore.approvals.push({
      id: `approval-row-${this.committedStore.approvals.length + 1}`,
      approval_digest: request.approvalDigest,
      schema_version: "1",
      project_slug: request.projectSlug,
      target: request.target,
      target_project_id: request.targetProjectId,
      plan_hash: request.planHash,
      collision_report_fingerprint: request.collisionReportFingerprint,
      operation_count: request.operationCounts.operations,
      approved_request: structuredClone(request),
      approved_request_digest: fakeServerRequestDigest(request),
      issued_at: issuedAt,
      expires_at: expiresAt,
      consumed_at: null,
      execution_id: null,
    });
  }

  /**
   * One fixed-statement invocation = one transaction. Any raise returns a
   * sanitized error and discards ALL staged state (writes, approval
   * consumption, receipt).
   */
  async call(request: unknown): Promise<DatabaseExecutionResponse> {
    this.calls += 1;
    if (this.config.throwOnCall !== undefined) throw this.config.throwOnCall;
    if (this.config.neverResolve) return new Promise<DatabaseExecutionResponse>(() => {});
    if (this.config.rawError !== undefined) return { result: null, error: this.config.rawError };
    if (this.config.malformedData !== undefined) {
      return { result: this.config.malformedData, error: null };
    }

    const staged = structuredClone(this.committedStore);
    try {
      const result = this.runTransaction(staged, request as ServerExecutionRequest);
      if (this.config.commitFails) {
        // The function body succeeded but the commit did not; nothing durable
        // changes and only a raw (untrusted) provider error leaves the server.
        return {
          result: null,
          error: { message: "server closed the connection unexpectedly", code: "XX000" },
        };
      }
      this.committedStore = staged;
      return { result, error: null };
    } catch (error) {
      if (error instanceof ServerRaise) {
        return {
          result: null,
          error: {
            message: error.message,
            code: "P0001",
            details: "detail: must never surface to a receipt or log",
            hint: "hint: must never surface either",
          },
        };
      }
      return { result: null, error: { message: "unexpected server error", code: "XX000" } };
    }
  }

  // ---- Transaction body (mirrors the migration's plpgsql function) ---------

  private runTransaction(staged: FakeServerStore, request: ServerExecutionRequest): unknown {
    let writes = 0;
    const guardWrite = () => {
      writes += 1;
      const injected = this.config.raiseAfterWrites;
      if (injected && writes === injected.writes) throw new ServerRaise(injected.code);
    };

    if (!request || typeof request !== "object") throw new ServerRaise("request_malformed");
    if (request.schemaVersion !== "1") throw new ServerRaise("request_schema_unsupported");
    const counts = request.operationCounts;
    if (counts.projects !== 1) throw new ServerRaise("request_operation_counts_invalid");
    if (counts.operations > 1000) throw new ServerRaise("request_operation_count_exceeded");
    if (
      counts.operations !==
      counts.projects + counts.buildings + counts.units + counts.priceHistoryRows
    ) {
      throw new ServerRaise("request_operation_counts_invalid");
    }

    // --- Approved-request binding (BEFORE any durable consumption) ---------
    const now = this.now();
    const approval = staged.approvals.find((row) => row.approval_digest === request.approvalDigest);
    if (!approval) throw new ServerRaise("approval_unknown");
    if (approval.consumed_at !== null) throw new ServerRaise("approval_already_consumed");

    if (now.getTime() < Date.parse(approval.issued_at)) {
      throw new ServerRaise("approval_not_yet_valid");
    }
    if (now.getTime() >= Date.parse(approval.expires_at)) {
      throw new ServerRaise("approval_expired");
    }
    if (
      approval.project_slug !== request.projectSlug ||
      approval.target !== request.target ||
      approval.target_project_id !== request.targetProjectId ||
      approval.plan_hash !== request.planHash ||
      approval.collision_report_fingerprint !== request.collisionReportFingerprint ||
      approval.operation_count !== counts.operations
    ) {
      throw new ServerRaise("approval_scope_mismatch");
    }

    // The executed payload must BE the approved payload: structural equality
    // (key-order-insensitive, array-order-SENSITIVE, includes the fingerprint
    // field itself) plus a server-side digest recomputation. A tampered but
    // self-consistent client request fails here with nothing consumed and
    // nothing written.
    if (canonicalJsonString(request) !== canonicalJsonString(approval.approved_request)) {
      throw new ServerRaise("approval_request_mismatch");
    }
    if (fakeServerRequestDigest(request) !== approval.approved_request_digest) {
      throw new ServerRaise("approval_request_mismatch");
    }

    // --- Atomic approval consumption (same transaction as all writes) ------
    const executionId = this.nextExecutionId();
    approval.consumed_at = now.toISOString();
    approval.execution_id = executionId;

    // --- Repeat-import boundary --------------------------------------------
    if (
      staged.receipts.some(
        (row) => row.project_slug === request.projectSlug && row.plan_hash === request.planHash,
      )
    ) {
      throw new ServerRaise("plan_already_executed");
    }

    // --- Fresh-state verification inside the transaction --------------------
    if (staged.projects.some((row) => row.slug === request.projectSlug)) {
      throw new ServerRaise("target_state_changed");
    }

    // --- Dependencies --------------------------------------------------------
    const project = request.entities.project;
    const developers = staged.developers.filter((row) => row.slug === project.developer_slug);
    if (developers.length !== 1) throw new ServerRaise("dependency_developer_unresolved");
    const locations = staged.locations.filter((row) => row.slug === project.location_slug);
    if (locations.length !== 1) throw new ServerRaise("dependency_location_unresolved");

    // --- Writes in canonical dependency order --------------------------------
    const projectId = `srv-proj-${this.executionSequence}`;
    const { developer_slug: _d, location_slug: _l, ...projectColumns } = project;
    staged.projects.push({
      ...projectColumns,
      id: projectId,
      developer_id: developers[0].id,
      location_id: locations[0].id,
    });
    guardWrite();

    const buildingIdByCode = new Map<string, string>();
    request.entities.buildings.forEach((building, index) => {
      const id = `srv-${this.executionSequence}-bldg-${index + 1}`;
      staged.buildings.push({ ...building, id, project_id: projectId });
      buildingIdByCode.set(building.building_code, id);
      guardWrite();
    });

    const unitIdByCode = new Map<string, string>();
    request.entities.units.forEach((unit, index) => {
      let buildingId: string | null = null;
      if (unit.building_code !== null) {
        const resolved = buildingIdByCode.get(unit.building_code);
        if (!resolved) throw new ServerRaise("missing_parent_reference");
        buildingId = resolved;
      }
      const id = `srv-${this.executionSequence}-unit-${index + 1}`;
      const { building_code: _bc, ...unitColumns } = unit;
      staged.units.push({ ...unitColumns, id, project_id: projectId, building_id: buildingId });
      unitIdByCode.set(unit.unit_code, id);
      guardWrite();
    });

    request.entities.priceHistory.forEach((price, index) => {
      const unitId = unitIdByCode.get(price.unit_code);
      if (!unitId) throw new ServerRaise("missing_parent_reference");
      const { unit_code: _uc, ...priceColumns } = price;
      staged.priceHistory.push({
        ...priceColumns,
        id: `srv-${this.executionSequence}-price-${index + 1}`,
        unit_id: unitId,
      });
      guardWrite();
    });

    if (writes !== counts.operations) throw new ServerRaise("verification_count_mismatch");

    // --- Verification before commit -----------------------------------------
    this.config.tamperBeforeVerification?.(staged);
    this.verify(staged, request, projectId, buildingIdByCode, unitIdByCode);

    // --- Durable receipt (same transaction) ----------------------------------
    staged.receipts.push({
      execution_id: executionId,
      approval_digest: request.approvalDigest,
      request_fingerprint: request.requestFingerprint,
      project_slug: request.projectSlug,
      target: request.target,
      target_project_id: request.targetProjectId,
      plan_hash: request.planHash,
      collision_report_fingerprint: request.collisionReportFingerprint,
      projects_written: counts.projects,
      buildings_written: counts.buildings,
      units_written: counts.units,
      price_history_rows_written: counts.priceHistoryRows,
      writes_performed: writes,
      outcome: "committed",
    });

    return {
      schemaVersion: "1",
      outcome: "committed",
      executionId,
      approvalDigest: request.approvalDigest,
      requestFingerprint: request.requestFingerprint,
      projectSlug: request.projectSlug,
      target: request.target,
      targetProjectId: request.targetProjectId,
      planHash: request.planHash,
      collisionReportFingerprint: request.collisionReportFingerprint,
      operationCounts: { ...counts },
      writesPerformed: writes,
      commitConfirmed: true,
    };
  }

  private verify(
    staged: FakeServerStore,
    request: ServerExecutionRequest,
    projectId: string,
    buildingIdByCode: Map<string, string>,
    unitIdByCode: Map<string, string>,
  ): void {
    const counts = request.operationCounts;

    const projectRows = staged.projects.filter((row) => row.slug === request.projectSlug);
    if (projectRows.length === 0) throw new ServerRaise("verification_row_missing");
    if (projectRows.length > 1) throw new ServerRaise("verification_duplicate_persistence_key");
    const projectRow = projectRows[0];
    if (projectRow.id !== projectId) throw new ServerRaise("verification_parent_mismatch");
    const { developer_slug: _d, location_slug: _l, ...projectColumns } = request.entities.project;
    for (const [field, expected] of Object.entries(projectColumns)) {
      if (canonicalJsonString(projectRow[field]) !== canonicalJsonString(expected)) {
        throw new ServerRaise("verification_field_mismatch");
      }
    }

    const buildingRows = staged.buildings.filter((row) => row.project_id === projectId);
    if (buildingRows.length < counts.buildings) throw new ServerRaise("verification_row_missing");
    if (buildingRows.length > counts.buildings) throw new ServerRaise("verification_extra_rows");
    const buildingCodes = new Set(buildingRows.map((row) => row.building_code));
    if (buildingCodes.size !== counts.buildings) {
      throw new ServerRaise("verification_duplicate_persistence_key");
    }
    for (const building of request.entities.buildings) {
      const row = buildingRows.find((item) => item.building_code === building.building_code);
      if (!row) throw new ServerRaise("verification_row_missing");
      if (row.id !== buildingIdByCode.get(building.building_code)) {
        throw new ServerRaise("verification_parent_mismatch");
      }
      this.compareFields(building as unknown as Record<string, unknown>, row, ["building_code"]);
    }

    const unitRows = staged.units.filter((row) => row.project_id === projectId);
    if (unitRows.length < counts.units) throw new ServerRaise("verification_row_missing");
    if (unitRows.length > counts.units) throw new ServerRaise("verification_extra_rows");
    const unitCodes = new Set(unitRows.map((row) => row.unit_code));
    if (unitCodes.size !== counts.units) {
      throw new ServerRaise("verification_duplicate_persistence_key");
    }
    for (const unit of request.entities.units) {
      const row = unitRows.find((item) => item.unit_code === unit.unit_code);
      if (!row) throw new ServerRaise("verification_row_missing");
      if (row.id !== unitIdByCode.get(unit.unit_code)) {
        throw new ServerRaise("verification_parent_mismatch");
      }
      const expectedBuildingId =
        unit.building_code === null ? null : (buildingIdByCode.get(unit.building_code) ?? null);
      if ((row.building_id ?? null) !== expectedBuildingId) {
        throw new ServerRaise("verification_parent_mismatch");
      }
      this.compareFields(unit as unknown as Record<string, unknown>, row, [
        "unit_code",
        "building_code",
      ]);
    }

    const freshUnitIds = new Set(unitIdByCode.values());
    const priceRows = staged.priceHistory.filter((row) => freshUnitIds.has(row.unit_id as string));
    if (priceRows.length < counts.priceHistoryRows) {
      throw new ServerRaise("verification_row_missing");
    }
    if (priceRows.length > counts.priceHistoryRows) {
      throw new ServerRaise("verification_extra_rows");
    }
    const priceKeys = new Set(
      priceRows.map((row) =>
        JSON.stringify([
          row.unit_id,
          row.price_source,
          row.source_file,
          row.source_page,
          row.price_list_date,
        ]),
      ),
    );
    if (priceKeys.size !== counts.priceHistoryRows) {
      throw new ServerRaise("verification_duplicate_persistence_key");
    }
    for (const price of request.entities.priceHistory) {
      const unitId = unitIdByCode.get(price.unit_code);
      const matches = priceRows.filter(
        (row) =>
          row.unit_id === unitId &&
          (row.price_source ?? null) === price.price_source &&
          (row.source_file ?? null) === price.source_file &&
          (row.source_page ?? null) === price.source_page &&
          (row.price_list_date ?? null) === price.price_list_date,
      );
      if (matches.length === 0) throw new ServerRaise("verification_row_missing");
      if (matches.length > 1) throw new ServerRaise("verification_duplicate_persistence_key");
      this.compareFields(price as unknown as Record<string, unknown>, matches[0], [
        "unit_code",
        "price_source",
        "source_file",
        "source_page",
        "price_list_date",
      ]);
    }
  }

  private compareFields(
    expected: Record<string, unknown>,
    actual: Record<string, unknown>,
    excluded: string[],
  ): void {
    for (const [field, value] of Object.entries(expected)) {
      if (excluded.includes(field)) continue;
      if (canonicalJsonString(actual[field]) !== canonicalJsonString(value)) {
        throw new ServerRaise("verification_field_mismatch");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Transport and approval helpers
// ---------------------------------------------------------------------------

/**
 * Direct-PostgreSQL transport that records each invocation and delegates the
 * single fixed statement to the fake server. Exposes exactly one method with
 * only the request as its argument — no function name, schema, or SQL.
 */
export class FakeApprovedImportDatabaseTransport implements ApprovedImportDatabaseTransport {
  public invocations = 0;

  constructor(private readonly server: FakeImportExecutionServer) {}

  executeApprovedImport(request: ServerExecutionRequest): Promise<DatabaseExecutionResponse> {
    this.invocations += 1;
    return this.server.call(request);
  }
}

/**
 * A structurally tampered but SELF-CONSISTENT variant of a request: the
 * mutation is applied and the client-side fingerprint is recomputed, exactly
 * as a malicious client controlling its own code would do. Used both to
 * register scope-variant approvals and to prove the server rejects any
 * payload that is not the approved one.
 */
export function resignedRequestVariant(
  request: ServerExecutionRequest,
  mutate: (draft: ServerExecutionRequest) => void,
): ServerExecutionRequest {
  const draft = structuredClone(request);
  mutate(draft);
  draft.requestFingerprint = fingerprintServerExecutionRequest(
    draft as unknown as Record<string, unknown>,
  );
  return draft;
}

export type { ServerBuildingEntity, ServerPriceHistoryEntity, ServerUnitEntity };
