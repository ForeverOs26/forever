import type { ExecutionConnectorPacket } from "../execution-connector";
import type { ContinueStopCode, CurrentTaskEnvelope } from "./contracts";

/**
 * Current-task resolution for Continue Forever.
 *
 * The command may execute only a Task Packet that is already explicitly
 * approved, and only when exactly one executable current task exists. This
 * resolver is the fail-closed gate: it returns the single approved current
 * packet or a coded stop. It never approves, repairs, or replaces a packet.
 */

export type CurrentTaskResolution =
  | { readonly ok: true; readonly envelope: CurrentTaskEnvelope }
  | { readonly ok: false; readonly code: ContinueStopCode; readonly reasons: readonly string[] };

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const BASE_COMMIT_PATTERN = /^[0-9a-fA-F]{40}$/;

/** Structural Task Packet validation (schema-equivalent, fail closed). */
function validatePacketShape(packet: ExecutionConnectorPacket): string[] {
  const problems: string[] = [];
  const routing = packet?.routing;
  const execution = packet?.execution;
  const handoff = packet?.handoff;

  if (!routing || !execution || !handoff) {
    problems.push("Task Packet must contain routing, execution, and handoff sections.");
    return problems;
  }
  if (!routing.taskPacketId || !TASK_ID_PATTERN.test(routing.taskPacketId)) {
    problems.push("Task Packet ID is missing or does not match the contract.");
  }
  if (!routing.title || routing.title.trim().length === 0) {
    problems.push("Task Packet mission title is required.");
  }
  if (!["R0", "R1", "R2", "R3"].includes(routing.riskClass)) {
    problems.push("A valid risk classification (R0–R3) is required.");
  }
  if (!Array.isArray(execution.allowedScope) || execution.allowedScope.length === 0) {
    problems.push("Allowed scope must be explicit and contain at least one path.");
  }
  if (!execution.stopCondition || execution.stopCondition.trim().length === 0) {
    problems.push("A stop condition must be explicit.");
  }
  if (!execution.prompt || execution.prompt.trim().length === 0) {
    problems.push("An execution prompt is required.");
  }
  if (!execution.expectedBaseCommit || !BASE_COMMIT_PATTERN.test(execution.expectedBaseCommit)) {
    problems.push("A valid 40-character expected base commit is required.");
  }
  if (!["full", "quick"].includes(handoff.validationProfile)) {
    problems.push("A gate profile (validationProfile full or quick) must exist.");
  }
  return problems;
}

/**
 * Resolve the single approved current Task Packet from the supplied source.
 *
 * Fail-closed order: no current task, more than one current task, superseded,
 * completed, already in-progress, unapproved, then structural invalidity. Only
 * after every check passes is the packet returned for execution.
 */
export function resolveCurrentTask(
  envelopes: readonly CurrentTaskEnvelope[],
): CurrentTaskResolution {
  const currents = envelopes.filter((entry) => entry?.isCurrent === true);

  if (currents.length === 0) {
    return {
      ok: false,
      code: "NO_CURRENT_TASK",
      reasons: ["No packet is marked as the current task; nothing to continue."],
    };
  }
  if (currents.length > 1) {
    return {
      ok: false,
      code: "MULTIPLE_CURRENT_TASKS",
      reasons: [
        `Found ${currents.length} packets marked current (${currents
          .map((entry) => entry.packet?.routing?.taskPacketId ?? "unknown")
          .join(", ")}); exactly one is required.`,
      ],
    };
  }

  const envelope = currents[0];
  const packet = envelope.packet;
  const approvalState = packet?.routing?.approvalState;

  if (envelope.supersededBy) {
    return {
      ok: false,
      code: "CURRENT_TASK_SUPERSEDED",
      reasons: [`Current task is superseded by ${envelope.supersededBy}; it must not execute.`],
    };
  }
  if (approvalState === "completed") {
    return {
      ok: false,
      code: "CURRENT_TASK_ALREADY_COMPLETED",
      reasons: ["Current task approval state is completed; it must not execute again."],
    };
  }
  if (approvalState === "in-progress") {
    return {
      ok: false,
      code: "CURRENT_TASK_ALREADY_RUNNING",
      reasons: ["Current task approval state is in-progress; refusing a concurrent execution."],
    };
  }
  if (approvalState !== "approved") {
    return {
      ok: false,
      code: "CURRENT_TASK_NOT_APPROVED",
      reasons: [
        `Current task approval state is "${approvalState ?? "missing"}"; only an approved packet may execute.`,
      ],
    };
  }

  const problems = validatePacketShape(packet);
  if (problems.length > 0) {
    return { ok: false, code: "CURRENT_TASK_INVALID", reasons: problems };
  }

  return { ok: true, envelope };
}

/**
 * Thrown by a source reader when `.forever-factory/CONTINUE_TASK.json` is
 * unreadable or malformed. The orchestrator maps it to a structured
 * CURRENT_TASK_INVALID stop rather than an unstructured top-level exception.
 */
export class SourceReadError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SourceReadError";
  }
}

/**
 * The strict state of the Operator canonical `.forever-factory/CURRENT_TASK.json`.
 * The CLI computes it; `absent` when the file does not exist, `valid` with the
 * task id when it parses and validates, and `invalid` (with a reason) when it is
 * unreadable, malformed, missing/invalid `taskId`, or of an invalid task shape.
 */
export type OperatorTaskState =
  | { readonly status: "absent" }
  | { readonly status: "valid"; readonly taskId: string }
  | { readonly status: "invalid"; readonly reason: string };

export type OperatorReconcileResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "CURRENT_TASK_STATE_CONFLICT" | "CURRENT_TASK_STATE_INVALID";
      readonly reasons: string[];
    };

const OPERATOR_TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

/**
 * Validate a parsed Operator canonical task object (the Operator v0.1 shape,
 * consumed read-only). Returns the strict `OperatorTaskState`. A caller that
 * cannot read or JSON-parse the file passes `{ status: "invalid" }` directly.
 */
export function evaluateOperatorTaskObject(value: unknown): OperatorTaskState {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { status: "invalid", reason: "CURRENT_TASK.json must be a JSON object." };
  }
  const task = value as Record<string, unknown>;
  if (typeof task.taskId !== "string" || !OPERATOR_TASK_ID_PATTERN.test(task.taskId)) {
    return { status: "invalid", reason: "CURRENT_TASK.json is missing a valid taskId." };
  }
  if (task.schemaVersion !== undefined && task.schemaVersion !== "0.1") {
    return { status: "invalid", reason: "CURRENT_TASK.json has an unsupported schemaVersion." };
  }
  return { status: "valid", taskId: task.taskId };
}

/**
 * Reconcile the Continue source packet id with the Operator canonical task state
 * so there is one authoritative Task Packet identity.
 *
 * `.forever-factory/CONTINUE_TASK.json` (the Continue envelope source) is not the
 * Operator canonical task. An `absent` Operator task is allowed (Continue may run
 * before a handoff task exists); a `valid` matching id is allowed; a `valid`
 * differing id fails closed with CURRENT_TASK_STATE_CONFLICT; and an `invalid`
 * Operator task fails closed with CURRENT_TASK_STATE_INVALID — never a silent
 * skip. All of these stop before lock acquisition, routing, and any adapter call.
 */
export function reconcileOperatorState(
  continueTaskId: string,
  state: OperatorTaskState,
): OperatorReconcileResult {
  if (state.status === "absent") return { ok: true };
  if (state.status === "invalid") {
    return {
      ok: false,
      code: "CURRENT_TASK_STATE_INVALID",
      reasons: [
        `Operator canonical CURRENT_TASK.json is invalid: ${state.reason} ` +
          "Continue Forever fails closed instead of skipping reconciliation.",
      ],
    };
  }
  if (state.taskId !== continueTaskId) {
    return {
      ok: false,
      code: "CURRENT_TASK_STATE_CONFLICT",
      reasons: [
        `Continue source task id "${continueTaskId}" conflicts with the Operator canonical ` +
          `CURRENT_TASK.json task id "${state.taskId}". Refusing to choose one silently.`,
      ],
    };
  }
  return { ok: true };
}
