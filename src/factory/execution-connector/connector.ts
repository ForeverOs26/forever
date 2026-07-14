import {
  routeTaskPacket,
  type PriorModelAttempt,
  type RoutingDecision,
  type TaskPacketRoutingMetadata,
} from "../model-router";
import {
  buildOperatorHandoff,
  type ExecutionResult,
  type HandoffPacketControls,
} from "../operator-handoff";
import type { EffortLevel, WorkerTier } from "../routing-table";
import {
  resolveProviderModel,
  type AdapterFailureClass,
  type AdapterResult,
  type BlockedCode,
  type BlockedDetail,
  type ConnectorArtifact,
  type ExecutionCapture,
  type ExecutionConnectorPacket,
  type ExecutionRequest,
  type ProviderAdapter,
  type RunState,
  type StructuredFailure,
} from "./contracts";
import { redactEvidence, redactSecrets } from "./redaction";
import { deriveRunId, InMemoryRunStore, REPLAYABLE_STATES, type RunStore } from "./run-store";

/**
 * FACTORY-A1-002 Execution Connector.
 *
 * Accepts exactly one Owner-approved Task Packet, uses the exact FACTORY-A1-001
 * routing decision, builds a deterministic execution request, runs it through a
 * provider adapter, captures the result, and converts a successful execution
 * into the existing Forever Operator v0.1 handoff artifact. It never merges,
 * never starts another packet, never silently changes model or effort, never
 * bypasses Fable or max approval, and redacts secrets from every artifact.
 */

/** Injected clock keeps timestamps deterministic under test. */
export interface ConnectorRuntime {
  readonly now: () => string;
  readonly store: RunStore;
}

export interface RunConnectorOptions {
  readonly runtime?: Partial<ConnectorRuntime>;
}

const OPERATOR_COMMAND_HINT =
  "powershell -ExecutionPolicy Bypass -File .\\scripts\\forever-operator\\Invoke-ForeverOperator.ps1 " +
  "-TaskFile .\\.forever-factory\\CURRENT_TASK.json";

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

/** Maps an adapter failure class to the router's carry-forward attempt class. */
const FAILURE_CLASS_MAP: Record<AdapterFailureClass, PriorModelAttempt["failureClass"]> = {
  provider: "capability",
  capability: "capability",
  timeout: "environment",
  environment: "environment",
};

function emptyCapture(): ExecutionCapture {
  return {
    providerExecutionId: null,
    startedAt: null,
    finishedAt: null,
    exitStatus: null,
    selectedTier: null,
    selectedModel: null,
    providerModel: null,
    selectedEffort: null,
    resultSummary: "",
    patchPath: null,
    worktreePath: null,
    validationInstructions: null,
    failure: null,
    escalationHistory: [],
  };
}

/** Deterministic validation of the packet before any routing (responsibility 2). */
function validatePacket(packet: ExecutionConnectorPacket): string[] {
  const problems: string[] = [];
  const { routing, execution, handoff } = packet;
  if (!TASK_ID_PATTERN.test(routing.taskPacketId)) {
    problems.push("Task Packet ID does not match the Operator task id contract.");
  }
  if (routing.approvalState !== "approved") {
    problems.push(
      `Approval state is "${routing.approvalState}"; only an approved packet may execute.`,
    );
  }
  if (execution.allowedScope.length === 0) {
    problems.push("Allowed scope must contain at least one path.");
  }
  if (execution.stopCondition.trim().length === 0) {
    problems.push("A stop condition is required.");
  }
  if (execution.prompt.trim().length === 0) {
    problems.push("A task prompt is required.");
  }
  if (!["R0", "R1", "R2", "R3"].includes(routing.riskClass)) {
    problems.push("A valid risk classification (R0–R3) is required.");
  }
  if (!["full", "quick"].includes(handoff.validationProfile)) {
    problems.push("A required validation profile (full or quick) is required.");
  }
  if (!Number.isFinite(execution.timeoutMs) || execution.timeoutMs <= 0) {
    problems.push("A positive execution timeout is required.");
  }
  return problems;
}

function blockedArtifact(
  packet: ExecutionConnectorPacket,
  runId: string,
  adapterName: string,
  detail: BlockedDetail,
  selectionReasons: readonly string[] = [],
): ConnectorArtifact {
  return {
    schemaVersion: "0.1",
    taskPacketId: packet.routing.taskPacketId,
    runId,
    state: "blocked",
    adapter: adapterName,
    selectionReasons,
    capture: emptyCapture(),
    handoff: null,
    blocked: detail,
    automaticMerge: false,
    ownerReport: `Packet ${packet.routing.taskPacketId} blocked (${detail.code}): ${detail.reasons.join(" ")}`,
  };
}

function buildExecutionRequest(
  packet: ExecutionConnectorPacket,
  runId: string,
  decision: Extract<RoutingDecision, { decision: "route" }>,
  providerModel: string,
): ExecutionRequest {
  return {
    taskPacketId: packet.routing.taskPacketId,
    runId,
    model: decision.model,
    providerModel,
    tier: decision.tier,
    effort: decision.effort,
    prompt: packet.execution.prompt,
    workingDirectory: packet.execution.workingDirectory,
    allowedScope: packet.execution.allowedScope,
    forbiddenActions: packet.execution.forbiddenActions,
    timeoutMs: packet.execution.timeoutMs,
    expectedResultFormat: packet.execution.expectedResultFormat,
    stopCondition: packet.execution.stopCondition,
  };
}

function toStructuredFailure(
  result: Extract<AdapterResult, { status: "failed" }>,
  tier: WorkerTier,
  patchPath: string | undefined,
): StructuredFailure {
  const failureClass = FAILURE_CLASS_MAP[result.failureClass];
  return {
    failureClass: result.failureClass,
    exitStatus: result.exitStatus === "timeout" ? "timeout" : result.exitStatus,
    message: redactSecrets(result.message),
    carryForward: {
      tier,
      failureClass,
      diagnosis: redactSecrets(result.message),
      ...(patchPath ? { patchPath } : {}),
    },
  };
}

function handoffControls(packet: ExecutionConnectorPacket): HandoffPacketControls {
  return {
    allowedPaths: [...packet.execution.allowedScope],
    forbiddenPaths: [...packet.handoff.forbiddenPaths],
    branchName: packet.handoff.branchName,
    commitMessage: packet.handoff.commitMessage,
    createPullRequest: packet.handoff.createPullRequest,
    validationProfile: packet.handoff.validationProfile,
    validationMode: packet.handoff.validationMode,
  };
}

/**
 * Runs one Owner-approved Task Packet through the Execution Connector. Returns a
 * single deterministic {@link ConnectorArtifact}. The same packet submitted
 * twice against the same store returns the stored result without launching a
 * duplicate provider run.
 */
export async function runExecutionConnector(
  packet: ExecutionConnectorPacket,
  adapter: ProviderAdapter,
  options: RunConnectorOptions = {},
): Promise<ConnectorArtifact> {
  const store = options.runtime?.store ?? new InMemoryRunStore();
  const now = options.runtime?.now ?? (() => new Date().toISOString());
  const runId = deriveRunId(packet);
  const adapterName = adapter.capability.name;

  // Idempotency: never launch a duplicate provider run.
  const existing = store.get(runId);
  if (existing) {
    if (existing.state === "running") {
      return blockedArtifact(packet, runId, adapterName, {
        code: "duplicate_execution_in_flight",
        reasons: [`Run ${runId} is already in progress; refusing a duplicate execution.`],
        alternatives: ["Wait for the in-flight run to reach a terminal state before resubmitting."],
      });
    }
    if (existing.artifact && REPLAYABLE_STATES.has(existing.state)) {
      return existing.artifact;
    }
  }

  // 2. Validate the packet.
  const problems = validatePacket(packet);
  if (problems.length > 0) {
    const artifact = blockedArtifact(packet, runId, adapterName, {
      code: "packet_invalid",
      reasons: problems,
      alternatives: ["Correct the Task Packet and resubmit for Owner approval."],
    });
    store.put({ runId, taskPacketId: packet.routing.taskPacketId, state: "blocked", artifact });
    return artifact;
  }

  markState(store, runId, packet.routing.taskPacketId, "approved");

  // 3–4. Invoke the FACTORY-A1-001 router and respect every stop state.
  const routingMetadata: TaskPacketRoutingMetadata = packet.routing;
  const decision = routeTaskPacket(routingMetadata);
  if (decision.decision !== "route") {
    const artifact = blockedArtifact(packet, runId, adapterName, {
      code: "routing_stopped",
      routingStopCode: decision.code,
      reasons: decision.reasons,
      alternatives: decision.alternatives,
    });
    store.put({ runId, taskPacketId: packet.routing.taskPacketId, state: "blocked", artifact });
    return artifact;
  }

  markState(store, runId, packet.routing.taskPacketId, "routed");

  // Resolve provider model and validate adapter capability (fail closed).
  const modelResolution = resolveProviderModel(decision.model);
  if (!modelResolution.ok) {
    return blockAndStore(
      store,
      packet,
      runId,
      adapterName,
      {
        code: "unsupported_model",
        reasons: [modelResolution.reason],
        alternatives: ["Update the provider model map or route to a supported model tier."],
      },
      decision.reasons,
    );
  }
  const providerModel = modelResolution.providerModel;
  if (!adapter.capability.supportedModels.includes(providerModel)) {
    return blockAndStore(
      store,
      packet,
      runId,
      adapterName,
      {
        code: "unsupported_model",
        reasons: [
          `Adapter "${adapterName}" does not support model "${providerModel}"; refusing to substitute another model.`,
        ],
        alternatives: ["Select an adapter that supports the routed model, or re-route."],
      },
      decision.reasons,
    );
  }
  if (!adapter.capability.supportedEfforts.includes(decision.effort)) {
    return blockAndStore(
      store,
      packet,
      runId,
      adapterName,
      {
        code: "unsupported_effort",
        reasons: [
          `Adapter "${adapterName}" cannot apply "${decision.effort}" effort; refusing to pretend the effort was applied.`,
        ],
        alternatives: ["Select an adapter that supports the routed effort, or re-route."],
      },
      decision.reasons,
    );
  }

  // 5. Build the deterministic execution request.
  const request = buildExecutionRequest(packet, runId, decision, providerModel);

  // 6. Execute through the provider adapter.
  markState(store, runId, packet.routing.taskPacketId, "running");
  const startedAt = now();
  const result = await adapter.execute(request);
  const finishedAt = now();

  // 7. Capture the result.
  if (result.status === "failed") {
    const patchPathHint = undefined;
    const failure = toStructuredFailure(result, decision.tier, patchPathHint);
    const capture: ExecutionCapture = {
      providerExecutionId: result.providerExecutionId,
      startedAt,
      finishedAt,
      exitStatus: result.exitStatus === "timeout" ? "timeout" : result.exitStatus,
      selectedTier: decision.tier,
      selectedModel: decision.model,
      providerModel,
      selectedEffort: decision.effort,
      resultSummary: redactSecrets(result.message),
      patchPath: null,
      worktreePath: null,
      validationInstructions: null,
      failure,
      escalationHistory: [...packet.routing.priorModelAttempts, failure.carryForward],
    };
    const artifact = finalArtifact(packet, runId, adapterName, "failed", decision, capture, null);
    store.put({ runId, taskPacketId: packet.routing.taskPacketId, state: "failed", artifact });
    return artifact;
  }

  // Success path. 8. Convert into the Operator-compatible handoff.
  const patchPath = result.patchPath ?? null;
  const worktreePath = result.worktreePath ?? null;
  const baseCapture: ExecutionCapture = {
    providerExecutionId: result.providerExecutionId,
    startedAt,
    finishedAt,
    exitStatus: result.exitStatus,
    selectedTier: decision.tier,
    selectedModel: decision.model,
    providerModel,
    selectedEffort: decision.effort,
    resultSummary: redactEvidence(result.resultSummary, 1000),
    patchPath,
    worktreePath,
    validationInstructions: `${OPERATOR_COMMAND_HINT} -Mode ${packet.handoff.validationMode}`,
    failure: null,
    escalationHistory: [...packet.routing.priorModelAttempts],
  };

  if (!patchPath) {
    // A report-only execution has no patch to hand off; captured as succeeded.
    const artifact = finalArtifact(
      packet,
      runId,
      adapterName,
      "succeeded",
      decision,
      baseCapture,
      null,
    );
    store.put({ runId, taskPacketId: packet.routing.taskPacketId, state: "succeeded", artifact });
    return artifact;
  }

  const execution: ExecutionResult = {
    status: "completed",
    patchPath,
    expectedBaseCommit: packet.execution.expectedBaseCommit,
    summary: redactEvidence(result.resultSummary, 400),
  };
  const handoffResult = buildOperatorHandoff(
    routingMetadata,
    decision,
    execution,
    handoffControls(packet),
  );
  if (!handoffResult.ok) {
    // The patch could not become a valid Operator task; capture as succeeded,
    // surface the contract problem, and never fabricate a handoff.
    const capture: ExecutionCapture = {
      ...baseCapture,
      validationInstructions: `Operator handoff rejected: ${handoffResult.reason}`,
    };
    const artifact = finalArtifact(
      packet,
      runId,
      adapterName,
      "succeeded",
      decision,
      capture,
      null,
    );
    store.put({ runId, taskPacketId: packet.routing.taskPacketId, state: "succeeded", artifact });
    return artifact;
  }

  const artifact = finalArtifact(
    packet,
    runId,
    adapterName,
    "handed_off",
    decision,
    baseCapture,
    handoffResult.handoff,
  );
  store.put({ runId, taskPacketId: packet.routing.taskPacketId, state: "handed_off", artifact });
  return artifact;
}

function markState(store: RunStore, runId: string, taskPacketId: string, state: RunState): void {
  store.put({ runId, taskPacketId, state, artifact: null });
}

function blockAndStore(
  store: RunStore,
  packet: ExecutionConnectorPacket,
  runId: string,
  adapterName: string,
  detail: BlockedDetail,
  selectionReasons: readonly string[],
): ConnectorArtifact {
  const artifact = blockedArtifact(packet, runId, adapterName, detail, selectionReasons);
  store.put({ runId, taskPacketId: packet.routing.taskPacketId, state: "blocked", artifact });
  return artifact;
}

function finalArtifact(
  packet: ExecutionConnectorPacket,
  runId: string,
  adapterName: string,
  state: Extract<RunState, "succeeded" | "failed" | "handed_off">,
  decision: Extract<RoutingDecision, { decision: "route" }>,
  capture: ExecutionCapture,
  handoff: ConnectorArtifact["handoff"],
): ConnectorArtifact {
  return {
    schemaVersion: "0.1",
    taskPacketId: packet.routing.taskPacketId,
    runId,
    state,
    adapter: adapterName,
    selectionReasons: decision.reasons,
    capture,
    handoff,
    blocked: null,
    automaticMerge: false,
    ownerReport: buildOwnerReport(packet, state, decision, capture),
  };
}

function buildOwnerReport(
  packet: ExecutionConnectorPacket,
  state: RunState,
  decision: Extract<RoutingDecision, { decision: "route" }>,
  capture: ExecutionCapture,
): string {
  const head =
    `Packet ${packet.routing.taskPacketId} (${packet.routing.riskClass}) executed by ` +
    `${decision.model} [${decision.tier} tier, ${decision.effort} effort] → ${state}.`;
  if (state === "failed" && capture.failure) {
    return `${head} Structured failure (${capture.failure.failureClass}): ${capture.failure.message} Carried forward for re-routing; automatic merge disabled.`;
  }
  if (state === "handed_off") {
    return `${head} ${capture.resultSummary} Operator handoff ready (${capture.validationInstructions}); automatic merge disabled.`;
  }
  return `${head} ${capture.resultSummary} No Operator handoff produced; automatic merge disabled.`;
}

export type { EffortLevel };
