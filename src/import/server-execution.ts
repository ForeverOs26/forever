import type { CollisionInspectionReport } from "./collision-inspector";
import type { ApprovalRegistry } from "./execution-approval";
import type { ImportTargetIdentity } from "./import-targets";
import type { ApprovedImportServerExecutor } from "./live-execution-adapter";
import type { ImportOperationCounts, PlanFingerprint } from "./plan-hash";
import type { ProjectManifestFields } from "./persistence-projection";
import type { ImportOperation } from "./types";
import { buildServerExecutionRequest } from "./server-execution-request";
import {
  buildImportExecutionReceipt,
  evaluateExecutionGates,
  type ImportExecutionReceipt,
} from "./transaction-executor";

/**
 * RC5.5D server-boundary execution of one approved import plan
 * (PREPARATION ONLY — the live adapter behind it stays disabled).
 *
 * This is the future live counterpart of the RC5.5C
 * {@link import("./transaction-executor").executeApprovedImportPlan}: it runs
 * the IDENTICAL pre-transaction gate pipeline (operation set, execution
 * ordering, RC5.5A preflight, fresh all-absent RC5.5B collision gate, Owner
 * approval validation) and the identical local atomic approval CAS, then —
 * instead of driving a multi-call transaction abstraction — builds ONE
 * bounded, canonical, fingerprinted server request and hands it to the typed
 * adapter, which runs exactly ONE fixed direct-PostgreSQL statement
 * (`SELECT forever_execution.forever_execute_approved_import($1::jsonb)`, not a
 * PostgREST RPC) against the server-side transaction
 * boundary. The server performs durable approval consumption, fresh-state
 * verification, all writes, persisted-row verification, and receipt creation
 * atomically; this module maps the adapter outcome to the truthful RC5.5C
 * receipt vocabulary.
 *
 * Consumption layering (documented policy): the local registry CAS burns the
 * artifact at the execution-attempt boundary exactly as in RC5.5C — exactly
 * one local winner, nothing consumed on earlier rejection, no automatic
 * retry. The DURABLE consumption happens server-side inside the import
 * transaction, so durably an approval is consumed if and only if the import
 * committed; a server-side rollback leaves no falsely consumed durable
 * approval, and re-presenting a rolled-back approval requires a new explicit
 * Owner decision because the local registry has already burned it.
 */
export interface ServerExecutionInput {
  executor: ApprovedImportServerExecutor;
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

export async function executeApprovedImportPlanViaServer(
  input: ServerExecutionInput,
): Promise<ImportExecutionReceipt> {
  const now = input.now ?? new Date();
  const context = {
    projectSlug: input.manifest.project_slug,
    requestedTarget: input.requestedTarget,
    targetIdentity: input.targetIdentity,
    planFingerprint: input.planFingerprint,
  };

  // ----- Identical RC5.5C pre-transaction gates (nothing consumed) ----------
  const gates = evaluateExecutionGates(input, now);
  if (!gates.ok) {
    return buildImportExecutionReceipt(context, {
      outcome: "rejected_before_transaction",
      reasonCodes: [gates.code],
      collisionReportFingerprint: gates.collisionReportFingerprint,
      approvalDigest: gates.candidateApprovalDigest,
      approvalConsumed: false,
      attempted: 0,
      applied: 0,
    });
  }

  let approvalConsumed = false;
  const reject = (code: string): ImportExecutionReceipt =>
    buildImportExecutionReceipt(context, {
      outcome: "rejected_before_transaction",
      reasonCodes: [code],
      collisionReportFingerprint: gates.collisionReportFingerprint,
      approvalDigest: gates.approvalDigest,
      approvalConsumed,
      attempted: 0,
      applied: 0,
    });

  // ----- Bounded server request (no adapter call yet) -----------------------
  const built = buildServerExecutionRequest({
    manifest: input.manifest,
    operations: input.operations,
    operationCounts: input.planFingerprint.operationCounts,
    planHash: input.planFingerprint.hash,
    target: gates.target,
    targetProjectId: input.targetIdentity.projectId ?? "",
    approvalDigest: gates.approvalDigest,
    collisionReportFingerprint: gates.collisionReportFingerprint,
  });
  if (!built.ok) return reject(`server_request_invalid:${built.code}`);

  // ----- Local atomic approval CAS (identical RC5.5C semantics) -------------
  let consumed: boolean;
  try {
    consumed = await input.approvalRegistry.consumeIfUnused(gates.approval.approvalId);
  } catch {
    return reject("approval_registry_unavailable");
  }
  if (!consumed) return reject("approval_reused");
  approvalConsumed = true;

  // ----- Exactly one adapter invocation; no retry ---------------------------
  const outcome = await input.executor.executeApprovedImportRequest(built.request);

  const finalize = (details: {
    outcome:
      | "committed"
      | "rolled_back"
      | "rejected_before_transaction"
      | "failed_rollback_unconfirmed";
    reasonCodes: string[];
    applied: number;
    executionId?: string | null;
  }): ImportExecutionReceipt =>
    buildImportExecutionReceipt(context, {
      outcome: details.outcome,
      reasonCodes: details.reasonCodes,
      collisionReportFingerprint: gates.collisionReportFingerprint,
      approvalDigest: gates.approvalDigest,
      approvalConsumed,
      attempted: details.applied,
      applied: details.applied,
      executionId: details.executionId ?? null,
    });

  switch (outcome.outcome) {
    case "committed":
      return finalize({
        outcome: "committed",
        reasonCodes: [],
        applied: outcome.result.writesPerformed,
        executionId: outcome.result.executionId,
      });
    case "rolled_back":
      return finalize({ outcome: "rolled_back", reasonCodes: [outcome.reasonCode], applied: 0 });
    case "rejected_before_transaction":
      return finalize({
        outcome: "rejected_before_transaction",
        reasonCodes: [outcome.reasonCode],
        applied: 0,
      });
    case "failed_rollback_unconfirmed":
    default:
      return finalize({
        outcome: "failed_rollback_unconfirmed",
        reasonCodes: [outcome.reasonCode ?? "adapter_failure"],
        applied: 0,
      });
  }
}
