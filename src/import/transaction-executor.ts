import type { BuildingInput, PriceHistoryInput, UnitInput } from "./database";
import type { ImportTargetIdentity } from "./import-targets";
import type { ImportOperationCounts, PlanFingerprint } from "./plan-hash";
import type { ImportEntityType, ImportOperation } from "./types";
import {
  comparePersistedEntityFields,
  fingerprintCollisionReport,
  IMPORT_ENTITY_EXECUTION_ORDER,
  validateImportOperationSet,
  type CollisionInspectionReport,
} from "./collision-inspector";
import {
  ExecutionFailure,
  isExecutionReasonCode,
  type ExecutionReasonCode,
  type ImportExecutionTransaction,
  type TransactionOutcome,
  type ImportTransactionRunner,
  type WrittenRowRef,
} from "./execution-adapter";
import {
  computeApprovalDigest,
  safeApprovalId,
  validateExecutionApproval,
  type ApprovalRegistry,
  type ExecutionApprovalScope,
} from "./execution-approval";
import {
  buildingPersistenceProjection,
  developerNaturalKey,
  locationNaturalKey,
  priceHistoryPersistenceProjection,
  projectPersistenceProjection,
  unitPersistenceProjection,
  type ProjectManifestFields,
} from "./persistence-projection";
import { runImportPreflight } from "./target-guard";

export const EXECUTION_RECEIPT_SCHEMA_VERSION = "1" as const;

/**
 * The live execution path remains disabled in RC5.5C. This constant is the
 * single source of truth surfaced in every receipt; enabling it is a separate
 * Owner-gated slice, never a code-review side effect.
 */
export const LIVE_EXECUTION_ENABLED = false as const;

/**
 * `rejected_before_transaction` is used ONLY for executor gates that fail
 * before the runner is ever invoked — the executor never infers
 * transaction-start state from runner behavior. `failed_rollback_unconfirmed`
 * is the truthful outcome for ANY runner-level anomaly (a throw before or
 * after the work callback, or a malformed outcome): a runner may begin a
 * transaction before invoking work, so neither commit nor rollback can be
 * confirmed and the receipt claims neither.
 */
export type ExecutionOutcome =
  | "committed"
  | "rolled_back"
  | "rejected_before_transaction"
  | "failed_rollback_unconfirmed";

export interface ImportExecutionReceipt {
  schemaVersion: typeof EXECUTION_RECEIPT_SCHEMA_VERSION;
  projectSlug: string;
  target: string;
  targetIdentity: { projectId: string };
  planHash: string;
  shortPlanHash: string;
  collisionReportFingerprint: string | null;
  /**
   * Display-safe server execution id (RC5.5D server path only, committed
   * outcomes only). Null/absent on every other path and outcome.
   */
  executionId?: string | null;
  /**
   * Domain-separated SHA-256 digest of the approval id — never the raw id.
   * Null when the artifact carried no format-safe id to digest.
   */
  approvalDigest: string | null;
  operationCounts: ImportOperationCounts;
  totalOperationsAttempted: number;
  totalOperationsApplied: number;
  outcome: ExecutionOutcome;
  commitConfirmed: boolean;
  rollbackConfirmed: boolean;
  executeEnabled: typeof LIVE_EXECUTION_ENABLED;
  /**
   * Confirmed persisted-write count. Exact applied count for `committed`;
   * 0 for `rolled_back` and `rejected_before_transaction`; null for
   * `failed_rollback_unconfirmed` — when the transaction outcome is unknown
   * the receipt never claims zero writes.
   */
  writesPerformed: number | null;
  /** Deterministic, deduplicated, sorted, sanitized reason codes. */
  reasonCodes: string[];
  approvalConsumed: boolean;
}

export interface ExecuteApprovedImportInput {
  runner: ImportTransactionRunner;
  approval: unknown;
  approvalRegistry: ApprovalRegistry;
  /** Injected clock so approval-expiry tests are deterministic. */
  now?: Date;
  requestedTarget?: string;
  targetIdentity: ImportTargetIdentity;
  manifest: ProjectManifestFields;
  sourceVersion: string;
  planFingerprint: PlanFingerprint;
  expectedPlanHash: string;
  expectedOperationCounts: ImportOperationCounts;
  confirmation: string;
  operations: ImportOperation[];
  collisionReport: CollisionInspectionReport;
}

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Execution-specific plan validation beyond the shared operation-set contract:
 * canonical transaction ordering, dependency direction, and resolvable parent
 * references. Returns a stable reason code, or null when valid.
 */
export function validateExecutionOrdering(operations: ImportOperation[]): string | null {
  let previousOrder = -1;
  for (const operation of operations) {
    const order = IMPORT_ENTITY_EXECUTION_ORDER[operation.entity];
    if (order === undefined) return "operation_order_invalid";
    if (order < previousOrder) return "operation_order_invalid";
    previousOrder = order;

    for (const dependency of operation.dependsOn ?? []) {
      const dependencyOrder = IMPORT_ENTITY_EXECUTION_ORDER[dependency as ImportEntityType];
      if (dependencyOrder === undefined || dependencyOrder >= order) return "dependency_cycle";
    }
  }

  const { buildingOps, unitOps, priceOps } = partition(operations);
  const plannedBuildingCodes = new Set(buildingOps.map((op) => op.payload.buildingCode));
  const plannedUnitCodes = new Set(unitOps.map((op) => op.payload.unitNumber));

  for (const op of unitOps) {
    const code = op.payload.buildingCode;
    if (code !== undefined && code !== null && !plannedBuildingCodes.has(code)) {
      return "missing_parent_reference";
    }
  }
  for (const op of priceOps) {
    if (!plannedUnitCodes.has(op.payload.unitNumber)) return "missing_parent_reference";
  }

  return null;
}

function collisionGate(
  report: CollisionInspectionReport,
  input: Pick<ExecutionGateInput, "planFingerprint" | "manifest" | "operations">,
): string | null {
  if (report.schemaVersion !== "1") return "collision_report_unsupported";
  if (report.planHash !== input.planFingerprint.hash) return "collision_report_stale_plan";
  if (report.projectSlug !== input.manifest.project_slug) {
    return "collision_report_project_mismatch";
  }
  if (report.operationSetError !== null) return "collision_report_blocked";
  if (report.totalInspectedOperations !== input.operations.length) {
    return "collision_report_incomplete";
  }
  const counts = report.countsByClassification;
  if (
    report.status === "blocked" ||
    report.blockingFindings.length > 0 ||
    counts.inspection_error > 0 ||
    counts.duplicate_target_rows > 0 ||
    counts.identity_conflict > 0
  ) {
    return "collision_report_blocked";
  }
  // Repeat-execution / idempotency boundary: RC5.5C only authorizes executing
  // into a proven-fresh target. Any exact_match or update_required finding —
  // including an exact repeat of a previously executed plan — fails closed
  // until an explicit safe repeat-import contract exists.
  if (counts.absent !== report.totalInspectedOperations) return "target_state_not_fresh";
  return null;
}

async function writeRef(
  attempt: () => Promise<WrittenRowRef>,
  failureCode: ExecutionReasonCode,
): Promise<WrittenRowRef> {
  let ref: WrittenRowRef;
  try {
    ref = await attempt();
  } catch (error) {
    if (error instanceof ExecutionFailure) throw error;
    throw new ExecutionFailure(failureCode);
  }
  if (!ref || !isNonEmptyString(ref.id)) throw new ExecutionFailure(failureCode);
  return ref;
}

async function readSafely<T>(
  attempt: () => Promise<T>,
  failureCode: ExecutionReasonCode,
): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (error instanceof ExecutionFailure) throw error;
    throw new ExecutionFailure(failureCode);
  }
}

function resolveDependencyRow(
  rows: Array<{ id: string; slug: string | null }>,
  expectedSlug: string,
  failureCode: ExecutionReasonCode,
): string {
  if (rows.length !== 1) throw new ExecutionFailure(failureCode);
  const row = rows[0];
  if (!row || !isNonEmptyString(row.id) || row.slug !== expectedSlug) {
    throw new ExecutionFailure(failureCode);
  }
  return row.id;
}

function priceVerificationKey(row: Record<string, unknown>): string {
  return JSON.stringify([
    row.unit_id ?? null,
    row.price_source ?? null,
    row.source_file ?? null,
    row.source_page ?? null,
    row.price_list_date ?? null,
  ]);
}

/**
 * The full RC5.5C pre-transaction gate pipeline, shared verbatim by the
 * RC5.5C transaction executor and the RC5.5D server-boundary executor so the
 * two paths can never drift: operation-set contract, execution ordering,
 * RC5.5A preflight, RC5.5B collision gate (fresh, unblocked, all-absent), and
 * Owner approval validation — in exactly that order, with exactly the RC5.5C
 * stable rejection codes. Performs no adapter call and consumes nothing.
 */
export interface ExecutionGateInput {
  approval: unknown;
  requestedTarget?: string;
  targetIdentity: ImportTargetIdentity;
  manifest: ProjectManifestFields;
  sourceVersion: string;
  planFingerprint: PlanFingerprint;
  expectedPlanHash: string;
  expectedOperationCounts: ImportOperationCounts;
  confirmation: string;
  operations: ImportOperation[];
  collisionReport: CollisionInspectionReport;
}

export type ExecutionGateOutcome =
  | {
      ok: true;
      approval: import("./execution-approval").ImportExecutionApproval;
      target: string;
      collisionReportFingerprint: string;
      approvalDigest: string;
    }
  | {
      ok: false;
      code: string;
      collisionReportFingerprint: string | null;
      candidateApprovalDigest: string | null;
    };

export function evaluateExecutionGates(input: ExecutionGateInput, now: Date): ExecutionGateOutcome {
  const slug = input.manifest.project_slug;
  // The raw approval id never reaches a receipt or log: only a deterministic
  // domain-separated digest is exposed, and only when the artifact carried a
  // format-safe id at all — otherwise null, so a hostile or secret-shaped id
  // cannot exfiltrate data through any external surface.
  const candidateSafeId =
    input.approval && typeof input.approval === "object"
      ? safeApprovalId((input.approval as Record<string, unknown>).approvalId)
      : null;
  const candidateApprovalDigest =
    candidateSafeId === null ? null : computeApprovalDigest(candidateSafeId);

  let collisionReportFingerprint: string | null = null;
  const reject = (code: string): ExecutionGateOutcome => ({
    ok: false,
    code,
    collisionReportFingerprint,
    candidateApprovalDigest,
  });

  const operationSetError = validateImportOperationSet({
    operations: input.operations,
    operationCounts: input.planFingerprint.operationCounts,
    manifest: input.manifest,
  });
  if (operationSetError) return reject("operation_set_invalid");

  const orderingError = validateExecutionOrdering(input.operations);
  if (orderingError) return reject(orderingError);

  const preflight = runImportPreflight({
    requestedTarget: input.requestedTarget,
    requestedProjectSlug: slug,
    actualPlanFingerprint: input.planFingerprint,
    expectedFullPlanHash: input.expectedPlanHash,
    expectedOperationCounts: input.expectedOperationCounts,
    manifestSourceVersion: input.sourceVersion,
    confirmation: input.confirmation,
    targetIdentity: input.targetIdentity,
  });
  if (!preflight.ok) return reject(`preflight_failed:${preflight.code}`);

  const gateError = collisionGate(input.collisionReport, input);
  if (gateError) return reject(gateError);

  collisionReportFingerprint = fingerprintCollisionReport(input.collisionReport);

  const scope: ExecutionApprovalScope = {
    projectSlug: slug,
    target: preflight.target,
    targetProjectId: input.targetIdentity.projectId ?? "",
    planHash: input.planFingerprint.hash,
    operationCount: input.operations.length,
    collisionReportFingerprint,
  };
  const approvalResult = validateExecutionApproval(input.approval, scope, now);
  if (!approvalResult.ok) return reject(approvalResult.code);

  return {
    ok: true,
    approval: approvalResult.approval,
    target: preflight.target,
    collisionReportFingerprint,
    approvalDigest: computeApprovalDigest(approvalResult.approval.approvalId),
  };
}

/**
 * RC5.5C transaction-backed execution of one approved import plan.
 *
 * Everything runs fail-closed: the request is rejected before any transaction
 * unless the operation set, execution ordering, RC5.5A preflight, RC5.5B
 * collision report (fresh, unblocked, all-absent), and the Owner approval
 * artifact all validate exactly. Inside the single transaction, every planned
 * operation is applied in canonical order and then verified against the shared
 * persistence projections before commit; any mismatch or failure rolls the
 * whole transaction back. Partial success is impossible.
 */
export async function executeApprovedImportPlan(
  input: ExecuteApprovedImportInput,
): Promise<ImportExecutionReceipt> {
  const now = input.now ?? new Date();

  const gates = evaluateExecutionGates(input, now);
  if (!gates.ok) {
    return buildReceipt(input, {
      outcome: "rejected_before_transaction",
      reasonCodes: [gates.code],
      collisionReportFingerprint: gates.collisionReportFingerprint,
      approvalDigest: gates.candidateApprovalDigest,
      approvalConsumed: false,
      attempted: 0,
      applied: 0,
    });
  }
  const approval = gates.approval;
  const collisionReportFingerprint = gates.collisionReportFingerprint;
  const slug = input.manifest.project_slug;
  let approvalConsumed = false;

  const reject = (code: string): ImportExecutionReceipt =>
    buildReceipt(input, {
      outcome: "rejected_before_transaction",
      reasonCodes: [code],
      collisionReportFingerprint,
      approvalDigest: gates.approvalDigest,
      approvalConsumed,
      attempted: 0,
      applied: 0,
    });

  // Single use, enforced ATOMICALLY at the execution-attempt boundary: the
  // durable-ready asynchronous compare-and-set below is the only reuse gate,
  // so of any number of concurrent attempts exactly one confirmed CAS winner
  // can proceed and every other one is rejected here without consuming
  // anything. A consumed attempt that later rolls back still burns the
  // approval; a repeat needs a new approval. A registry infrastructure
  // failure is contained: the raw error is discarded, the runner is never
  // invoked, and the receipt truthfully reports the approval as unconsumed.
  let consumed: boolean;
  try {
    consumed = await input.approvalRegistry.consumeIfUnused(approval.approvalId);
  } catch {
    return reject("approval_registry_unavailable");
  }
  if (!consumed) return reject("approval_reused");
  approvalConsumed = true;

  // ----- Transaction ---------------------------------------------------------
  const { buildingOps, unitOps, priceOps } = partition(input.operations);
  let attempted = 0;
  let applied = 0;

  const work = async (tx: ImportExecutionTransaction) => {
    // Dependency records first (must already exist; execution never writes them).
    const developerId = resolveDependencyRow(
      await readSafely(
        () => tx.readDeveloper(developerNaturalKey(input.manifest)),
        "dependency_read_failed",
      ),
      developerNaturalKey(input.manifest),
      "dependency_developer_unresolved",
    );
    const locationId = resolveDependencyRow(
      await readSafely(
        () => tx.readLocation(locationNaturalKey(input.manifest)),
        "dependency_read_failed",
      ),
      locationNaturalKey(input.manifest),
      "dependency_location_unresolved",
    );

    // The approved collision report proved an all-absent target; re-check the
    // anchor row inside the transaction so state drift since inspection rolls
    // back instead of double-importing.
    const existingProject = await readSafely(
      () => tx.readProject(slug),
      "verification_read_failed",
    );
    if (existingProject.length !== 0) throw new ExecutionFailure("target_state_changed");

    // Project.
    const projectProjection = projectPersistenceProjection(input.manifest, {
      developerId,
      locationId,
    });
    attempted += 1;
    const projectRef = await writeRef(
      () => tx.insertProject(projectProjection),
      "project_write_failed",
    );
    applied += 1;

    // Buildings, in plan order.
    const buildingIdByCode = new Map<string, string>();
    const buildingProjectionByCode = new Map<string, Record<string, unknown>>();
    for (const op of buildingOps) {
      const projection = buildingPersistenceProjection(projectRef.id, op.payload);
      attempted += 1;
      const ref = await writeRef(() => tx.insertBuilding(projection), "building_write_failed");
      applied += 1;
      buildingIdByCode.set(op.payload.buildingCode, ref.id);
      buildingProjectionByCode.set(op.payload.buildingCode, projection);
    }

    // Units, in plan order.
    const unitIdByCode = new Map<string, string>();
    const unitProjectionByCode = new Map<string, Record<string, unknown>>();
    for (const op of unitOps) {
      let buildingId: string | null = null;
      if (op.payload.buildingCode !== undefined && op.payload.buildingCode !== null) {
        const resolved = buildingIdByCode.get(op.payload.buildingCode);
        if (!resolved) throw new ExecutionFailure("missing_parent_reference");
        buildingId = resolved;
      }
      const projection = unitPersistenceProjection(projectRef.id, buildingId, op.payload);
      attempted += 1;
      const ref = await writeRef(() => tx.insertUnit(projection), "unit_write_failed");
      applied += 1;
      unitIdByCode.set(op.payload.unitNumber, ref.id);
      unitProjectionByCode.set(op.payload.unitNumber, projection as Record<string, unknown>);
    }

    // Price history, in plan order.
    const priceProjections: Array<Record<string, unknown>> = [];
    for (const op of priceOps) {
      const unitId = unitIdByCode.get(op.payload.unitNumber);
      if (!unitId) throw new ExecutionFailure("missing_parent_reference");
      const projection = priceHistoryPersistenceProjection(unitId, op.payload);
      attempted += 1;
      await writeRef(() => tx.insertPriceHistory(projection), "price_history_write_failed");
      applied += 1;
      priceProjections.push(projection as Record<string, unknown>);
    }

    if (applied !== input.operations.length)
      throw new ExecutionFailure("verification_count_mismatch");

    // ----- In-transaction verification before commit -------------------------
    const projectRows = await readSafely(() => tx.readProject(slug), "verification_read_failed");
    if (projectRows.length === 0) throw new ExecutionFailure("verification_row_missing");
    if (projectRows.length > 1)
      throw new ExecutionFailure("verification_duplicate_persistence_key");
    if (projectRows[0].id !== projectRef.id)
      throw new ExecutionFailure("verification_parent_mismatch");
    if (
      comparePersistedEntityFields(
        "project",
        projectProjection as Record<string, unknown>,
        projectRows[0],
      ).length
    ) {
      throw new ExecutionFailure("verification_field_mismatch");
    }

    const buildingRows = await readSafely(
      () => tx.readBuildings(projectRef.id),
      "verification_read_failed",
    );
    if (buildingRows.length < buildingOps.length)
      throw new ExecutionFailure("verification_row_missing");
    if (buildingRows.length > buildingOps.length)
      throw new ExecutionFailure("verification_extra_rows");
    const seenBuildingCodes = new Set<string>();
    for (const row of buildingRows) {
      const code = row.building_code;
      if (!isNonEmptyString(code)) throw new ExecutionFailure("verification_field_mismatch");
      if (seenBuildingCodes.has(code)) {
        throw new ExecutionFailure("verification_duplicate_persistence_key");
      }
      seenBuildingCodes.add(code);
      const expected = buildingProjectionByCode.get(code);
      if (!expected || row.id !== buildingIdByCode.get(code)) {
        throw new ExecutionFailure("verification_parent_mismatch");
      }
      if (comparePersistedEntityFields("building", expected, row).length) {
        throw new ExecutionFailure("verification_field_mismatch");
      }
    }

    const unitRows = await readSafely(
      () => tx.readUnits(projectRef.id),
      "verification_read_failed",
    );
    if (unitRows.length < unitOps.length) throw new ExecutionFailure("verification_row_missing");
    if (unitRows.length > unitOps.length) throw new ExecutionFailure("verification_extra_rows");
    const seenUnitCodes = new Set<string>();
    for (const row of unitRows) {
      const code = row.unit_code;
      if (!isNonEmptyString(code)) throw new ExecutionFailure("verification_field_mismatch");
      if (seenUnitCodes.has(code))
        throw new ExecutionFailure("verification_duplicate_persistence_key");
      seenUnitCodes.add(code);
      const expected = unitProjectionByCode.get(code);
      if (!expected || row.id !== unitIdByCode.get(code)) {
        throw new ExecutionFailure("verification_parent_mismatch");
      }
      if ((expected.building_id ?? null) !== (row.building_id ?? null)) {
        throw new ExecutionFailure("verification_parent_mismatch");
      }
      if (comparePersistedEntityFields("unit", expected, row).length) {
        throw new ExecutionFailure("verification_field_mismatch");
      }
    }

    const priceRows = await readSafely(
      () => tx.readPriceHistory([...unitIdByCode.values()]),
      "verification_read_failed",
    );
    if (priceRows.length < priceOps.length) throw new ExecutionFailure("verification_row_missing");
    if (priceRows.length > priceOps.length) throw new ExecutionFailure("verification_extra_rows");
    const expectedPriceByKey = new Map<string, Record<string, unknown>>();
    for (const projection of priceProjections) {
      expectedPriceByKey.set(priceVerificationKey(projection), projection);
    }
    const seenPriceKeys = new Set<string>();
    for (const row of priceRows) {
      const key = priceVerificationKey(row);
      if (seenPriceKeys.has(key))
        throw new ExecutionFailure("verification_duplicate_persistence_key");
      seenPriceKeys.add(key);
      const expected = expectedPriceByKey.get(key);
      if (!expected) throw new ExecutionFailure("verification_extra_rows");
      if (comparePersistedEntityFields("unit_price_history", expected, row).length) {
        throw new ExecutionFailure("verification_field_mismatch");
      }
    }
  };

  // The runner itself is untrusted infrastructure: begin/commit/rollback may
  // throw instead of returning an outcome, and it may begin a real transaction
  // before ever invoking the work callback. No raw runner or provider error may
  // escape; the raw error is deliberately discarded so URLs, SQL, headers,
  // credentials, and row data can never reach a receipt or the logger.
  let outcome: TransactionOutcome | null = null;
  let runnerThrew = false;
  try {
    outcome = await input.runner.runApprovedImport(work);
  } catch {
    runnerThrew = true;
  }

  const finalize = (details: {
    outcome: ExecutionOutcome;
    reasonCodes: ExecutionReasonCode[];
    applied: number;
  }): ImportExecutionReceipt =>
    buildReceipt(input, {
      outcome: details.outcome,
      reasonCodes: details.reasonCodes,
      collisionReportFingerprint,
      approvalDigest: computeApprovalDigest(approval.approvalId),
      approvalConsumed,
      attempted,
      applied: details.applied,
    });

  if (runnerThrew || outcome === null || typeof outcome !== "object") {
    // A runner-level throw or a missing outcome proves nothing about the
    // transaction: the runner may have begun one before invoking work, and
    // whether the work callback ran is irrelevant to that question. The only
    // truthful report is an unconfirmed failure — never a false
    // rollbackConfirmed and never an inferred rejected_before_transaction.
    return finalize({
      outcome: "failed_rollback_unconfirmed",
      reasonCodes: ["runner_failure"],
      applied: 0,
    });
  }

  if (outcome.outcome === "committed") {
    return finalize({ outcome: "committed", reasonCodes: [], applied });
  }

  if (outcome.outcome === "rolled_back") {
    // The runner's reason code is untrusted: only a literal member of the
    // closed stable-code set survives; anything else becomes adapter_failure.
    const reason: ExecutionReasonCode = isExecutionReasonCode(outcome.reasonCode)
      ? outcome.reasonCode
      : "adapter_failure";
    return finalize({ outcome: "rolled_back", reasonCodes: [reason], applied: 0 });
  }

  // Malformed outcome object: the runner supplied no trusted signal proving a
  // transaction never began, so neither commit nor rollback is confirmed.
  return finalize({
    outcome: "failed_rollback_unconfirmed",
    reasonCodes: ["runner_failure"],
    applied: 0,
  });
}

export interface ExecutionReceiptContext {
  projectSlug: string;
  requestedTarget?: string;
  targetIdentity: ImportTargetIdentity;
  planFingerprint: PlanFingerprint;
}

export interface ExecutionReceiptDetails {
  outcome: ExecutionOutcome;
  reasonCodes: string[];
  collisionReportFingerprint: string | null;
  approvalDigest: string | null;
  approvalConsumed: boolean;
  attempted: number;
  applied: number;
  executionId?: string | null;
}

/**
 * Shared truthful receipt assembly for the RC5.5C transaction executor and
 * the RC5.5D server-boundary executor: `writesPerformed` is the exact applied
 * count for `committed`, 0 for `rolled_back` and `rejected_before_transaction`,
 * and null for `failed_rollback_unconfirmed` (the receipt never claims zero
 * writes when the transaction outcome is unknown).
 */
export function buildImportExecutionReceipt(
  context: ExecutionReceiptContext,
  details: ExecutionReceiptDetails,
): ImportExecutionReceipt {
  const committed = details.outcome === "committed";
  const writesPerformed =
    details.outcome === "failed_rollback_unconfirmed" ? null : committed ? details.applied : 0;
  return {
    schemaVersion: EXECUTION_RECEIPT_SCHEMA_VERSION,
    projectSlug: context.projectSlug,
    target: context.requestedTarget ?? "",
    targetIdentity: { projectId: context.targetIdentity.projectId ?? "" },
    planHash: context.planFingerprint.hash,
    shortPlanHash: context.planFingerprint.shortHash,
    collisionReportFingerprint: details.collisionReportFingerprint,
    executionId: details.executionId ?? null,
    approvalDigest: details.approvalDigest,
    operationCounts: context.planFingerprint.operationCounts,
    totalOperationsAttempted: details.attempted,
    totalOperationsApplied: committed ? details.applied : 0,
    outcome: details.outcome,
    commitConfirmed: committed,
    rollbackConfirmed: details.outcome === "rolled_back",
    executeEnabled: LIVE_EXECUTION_ENABLED,
    writesPerformed,
    reasonCodes: [...new Set(details.reasonCodes)].sort(),
    approvalConsumed: details.approvalConsumed,
  };
}

function buildReceipt(
  input: ExecuteApprovedImportInput,
  details: ExecutionReceiptDetails,
): ImportExecutionReceipt {
  return buildImportExecutionReceipt(
    {
      projectSlug: input.manifest.project_slug,
      requestedTarget: input.requestedTarget,
      targetIdentity: input.targetIdentity,
      planFingerprint: input.planFingerprint,
    },
    details,
  );
}
