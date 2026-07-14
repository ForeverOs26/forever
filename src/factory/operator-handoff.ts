import type {
  PriorModelAttempt,
  RiskClass,
  RoutingDecision,
  TaskPacketRoutingMetadata,
} from "./model-router";
import type { EffortLevel, WorkerTier } from "./routing-table";

/**
 * Builds the handoff artifact from a routed, executed Task Packet into the
 * existing Forever Operator v0.1. The embedded `operatorTask` is the exact
 * `.forever-factory/CURRENT_TASK.json` contract defined by
 * `.forever-factory/task.schema.json`; the Operator itself is unchanged.
 *
 * The builder is fail-closed: any contract violation returns a coded failure
 * instead of an artifact, and automatic merge can never be enabled here.
 */

/** Mirror of `.forever-factory/task.schema.json` (Operator task v0.1). */
export interface OperatorTask {
  schemaVersion: "0.1";
  taskId: string;
  title: string;
  patchPath: string;
  expectedBaseCommit: string;
  allowedPaths: string[];
  forbiddenPaths: string[];
  riskOverride: "LOW" | "MEDIUM" | "HIGH" | null;
  branchName: string;
  commitMessage: string;
  createPullRequest: boolean;
  allowAutomaticMerge: boolean;
  validationProfile: "full" | "quick";
}

export interface ExecutionResult {
  status: "completed" | "failed";
  patchPath: string;
  expectedBaseCommit: string;
  summary: string;
  gateFailures?: string[];
}

export interface HandoffPacketControls {
  allowedPaths: string[];
  forbiddenPaths: string[];
  branchName: string;
  commitMessage: string;
  createPullRequest: boolean;
  validationProfile: "full" | "quick";
  validationMode: "dry-run" | "validate-only";
}

export interface OperatorHandoff {
  schemaVersion: "0.1";
  taskPacketId: string;
  selectedTier: WorkerTier;
  selectedModel: string;
  selectedEffort: EffortLevel;
  selectionReasons: string[];
  approvalState: "approved";
  executionResult: ExecutionResult;
  operatorTask: OperatorTask;
  validationInstructions: { mode: "dry-run" | "validate-only"; command: string };
  escalationHistory: PriorModelAttempt[];
  ownerSummary: string;
}

export type HandoffFailureCode =
  | "decision_not_routed"
  | "packet_not_approved"
  | "execution_not_completed"
  | "operator_task_invalid";

export type HandoffResult =
  | { ok: true; handoff: OperatorHandoff }
  | { ok: false; code: HandoffFailureCode; reason: string };

/**
 * Conservative packet-risk to Operator risk-floor mapping. `riskOverride` is a
 * floor: the Operator may raise the automatic risk further but never lower it.
 */
const RISK_OVERRIDE_FLOORS: Record<RiskClass, "LOW" | "MEDIUM" | "HIGH" | null> = {
  R0: null,
  R1: "MEDIUM",
  R2: "HIGH",
  R3: "HIGH",
};

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const BASE_COMMIT_PATTERN = /^[0-9a-fA-F]{40}$/;
const BRANCH_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]+$/;
// eslint-disable-next-line no-control-regex -- mirrors the schema's control-character exclusion
const COMMIT_MESSAGE_PATTERN = /^[^\u0000-\u001F\u007F]+$/;

export function validateOperatorTask(task: OperatorTask): string[] {
  const problems: string[] = [];
  if (task.schemaVersion !== "0.1") problems.push('schemaVersion must be "0.1".');
  if (!TASK_ID_PATTERN.test(task.taskId)) problems.push("taskId does not match the contract.");
  if (task.title.length < 1 || task.title.length > 160) {
    problems.push("title must be 1-160 characters.");
  }
  if (!task.patchPath.startsWith("inbox/")) {
    problems.push("patchPath must live inside the configured patch inbox.");
  }
  if (!BASE_COMMIT_PATTERN.test(task.expectedBaseCommit)) {
    problems.push("expectedBaseCommit must be a 40-character commit SHA.");
  }
  if (task.allowedPaths.length < 1 || task.allowedPaths.some((path) => path.length === 0)) {
    problems.push("allowedPaths must contain at least one non-empty path.");
  }
  if (new Set(task.allowedPaths).size !== task.allowedPaths.length) {
    problems.push("allowedPaths must be unique.");
  }
  if (task.forbiddenPaths.some((path) => path.length === 0)) {
    problems.push("forbiddenPaths must not contain empty paths.");
  }
  if (new Set(task.forbiddenPaths).size !== task.forbiddenPaths.length) {
    problems.push("forbiddenPaths must be unique.");
  }
  if (!BRANCH_NAME_PATTERN.test(task.branchName) || task.branchName.length > 128) {
    problems.push("branchName does not match the contract.");
  }
  if (
    task.commitMessage.length < 1 ||
    task.commitMessage.length > 200 ||
    !COMMIT_MESSAGE_PATTERN.test(task.commitMessage)
  ) {
    problems.push("commitMessage does not match the contract.");
  }
  if (task.allowAutomaticMerge !== false) {
    problems.push("allowAutomaticMerge must remain false.");
  }
  return problems;
}

function operatorCommand(mode: "dry-run" | "validate-only"): string {
  return (
    "powershell -ExecutionPolicy Bypass -File .\\scripts\\forever-operator\\Invoke-ForeverOperator.ps1 " +
    `-TaskFile .\\.forever-factory\\CURRENT_TASK.json -Mode ${mode}`
  );
}

export function buildOperatorHandoff(
  metadata: TaskPacketRoutingMetadata,
  decision: RoutingDecision,
  execution: ExecutionResult,
  controls: HandoffPacketControls,
): HandoffResult {
  if (decision.decision !== "route") {
    return {
      ok: false,
      code: "decision_not_routed",
      reason: `Routing stopped with code ${decision.code}; no Operator handoff may be built.`,
    };
  }
  if (metadata.approvalState !== "approved") {
    return {
      ok: false,
      code: "packet_not_approved",
      reason: "Only an Owner-approved packet may be handed to the Operator.",
    };
  }
  if (execution.status !== "completed") {
    return {
      ok: false,
      code: "execution_not_completed",
      reason:
        "A failed execution carries forward as a prior model attempt for re-routing, not as an Operator handoff.",
    };
  }

  const operatorTask: OperatorTask = {
    schemaVersion: "0.1",
    taskId: metadata.taskPacketId,
    title: metadata.title,
    patchPath: execution.patchPath,
    expectedBaseCommit: execution.expectedBaseCommit,
    allowedPaths: controls.allowedPaths,
    forbiddenPaths: controls.forbiddenPaths,
    riskOverride: RISK_OVERRIDE_FLOORS[metadata.riskClass],
    branchName: controls.branchName,
    commitMessage: controls.commitMessage,
    createPullRequest: controls.createPullRequest,
    allowAutomaticMerge: false,
    validationProfile: controls.validationProfile,
  };

  const problems = validateOperatorTask(operatorTask);
  if (problems.length > 0) {
    return {
      ok: false,
      code: "operator_task_invalid",
      reason: `Operator task contract violation: ${problems.join(" ")}`,
    };
  }

  const handoff: OperatorHandoff = {
    schemaVersion: "0.1",
    taskPacketId: metadata.taskPacketId,
    selectedTier: decision.tier,
    selectedModel: decision.model,
    selectedEffort: decision.effort,
    selectionReasons: decision.reasons,
    approvalState: "approved",
    executionResult: execution,
    operatorTask,
    validationInstructions: {
      mode: controls.validationMode,
      command: operatorCommand(controls.validationMode),
    },
    escalationHistory: metadata.priorModelAttempts,
    ownerSummary:
      `Packet ${metadata.taskPacketId} (${metadata.riskClass}) executed by ${decision.model} ` +
      `[${decision.tier} tier, ${decision.effort} effort]. ${execution.summary} ` +
      `Operator validation: ${controls.validationMode}; automatic merge disabled.`,
  };
  return { ok: true, handoff };
}
