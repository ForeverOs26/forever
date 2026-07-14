import type {
  AttemptFailureClass,
  PriorModelAttempt,
  RoutingStopCode,
  TaskPacketRoutingMetadata,
} from "../model-router";
import type { OperatorHandoff } from "../operator-handoff";
import type { EffortLevel, WorkerTier } from "../routing-table";

/**
 * Provider-neutral execution contract for FACTORY-A1-002.
 *
 * The Execution Connector automates the transport and execution mechanics that
 * the Owner performs by hand today: it accepts one Owner-approved Task Packet,
 * uses the exact FACTORY-A1-001 routing decision, prepares and runs the
 * selected Claude Code execution through a supported interface, captures the
 * result, and produces an artifact compatible with the existing Forever
 * Operator v0.1 handoff.
 *
 * These types are deliberately provider-neutral. A hermetic fake adapter and a
 * single real Claude Code adapter both implement {@link ProviderAdapter}; the
 * connector never couples to one Claude transport, and it invents no project
 * priorities and approves none of its own work.
 */

/** Replaceable router-model-string → provider model id mapping. */
export const PROVIDER_MODEL_MAP: Readonly<Record<string, string>> = {
  "Claude Sonnet 5.0": "claude-sonnet-5",
  "Claude Opus 4.8": "claude-opus-4-8",
  "Claude Fable 5.0": "claude-fable-5",
};

export type ProviderModelResolution =
  | { ok: true; providerModel: string }
  | { ok: false; reason: string };

/**
 * Fail-closed mapping from the router's replaceable model string to a concrete
 * provider model id. An unknown model string never falls back to a default; it
 * returns a coded failure so the connector can stop with an
 * unsupported-capability result instead of silently selecting another model.
 */
export function resolveProviderModel(model: string): ProviderModelResolution {
  const providerModel = PROVIDER_MODEL_MAP[model];
  if (!providerModel) {
    return {
      ok: false,
      reason: `No provider model is mapped for router model "${model}"; refusing to substitute a different model.`,
    };
  }
  return { ok: true, providerModel };
}

/** What the connector expects a successful execution to produce. */
export type ExpectedResultFormat = "patch" | "worktree" | "report";

/**
 * The deterministic execution request the connector builds from a routed,
 * approved packet (connector responsibility 5). It carries the exact selected
 * model and effort; adapters must honor them without reinterpretation.
 */
export interface ExecutionRequest {
  readonly taskPacketId: string;
  readonly runId: string;
  /** Router model string, e.g. "Claude Opus 4.8" (unchanged from the decision). */
  readonly model: string;
  /** Provider model id the adapter must select, e.g. "claude-opus-4-8". */
  readonly providerModel: string;
  readonly tier: WorkerTier;
  /** Exact effort from the router decision; passed through unchanged. */
  readonly effort: EffortLevel;
  readonly prompt: string;
  readonly workingDirectory: string;
  readonly allowedScope: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly timeoutMs: number;
  readonly expectedResultFormat: ExpectedResultFormat;
  readonly stopCondition: string;
}

/** Capability descriptor an adapter publishes so the connector can fail closed. */
export interface AdapterCapability {
  readonly name: string;
  readonly supportedModels: readonly string[];
  readonly supportedEfforts: readonly EffortLevel[];
}

export type AdapterFailureClass = "provider" | "timeout" | "capability" | "environment";

/**
 * The provider-neutral result of one execution attempt. Timestamps are stamped
 * by the connector's injected clock, not the adapter, so the captured artifact
 * stays deterministic under test.
 */
export type AdapterResult =
  | {
      readonly status: "succeeded";
      readonly providerExecutionId: string;
      readonly exitStatus: number;
      readonly resultSummary: string;
      readonly patchPath?: string;
      readonly worktreePath?: string;
      /** Optional raw operational evidence; the connector redacts it before capture. */
      readonly rawEvidence?: string;
    }
  | {
      readonly status: "failed";
      readonly providerExecutionId: string | null;
      readonly exitStatus: number | "timeout";
      readonly failureClass: AdapterFailureClass;
      readonly message: string;
      readonly rawEvidence?: string;
    };

/**
 * The minimal provider interface. An adapter selects the requested model and
 * effort exactly, or it is rejected by the connector's capability check before
 * {@link ProviderAdapter.execute} is ever called.
 */
export interface ProviderAdapter {
  readonly capability: AdapterCapability;
  execute(request: ExecutionRequest): Promise<AdapterResult>;
}

/** Deterministic connector run lifecycle states (connector responsibility: state and idempotency). */
export type RunState =
  | "approved"
  | "routed"
  | "blocked"
  | "running"
  | "succeeded"
  | "failed"
  | "handed_off";

export interface StructuredFailure {
  readonly failureClass: AdapterFailureClass;
  readonly exitStatus: number | "timeout" | "not-run";
  readonly message: string;
  /** Carried forward as a prior model attempt for deterministic re-routing. */
  readonly carryForward: PriorModelAttempt;
}

/** The captured execution result (connector responsibility 7). Fully redacted. */
export interface ExecutionCapture {
  readonly providerExecutionId: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly exitStatus: number | "timeout" | "not-run" | null;
  readonly selectedTier: WorkerTier | null;
  readonly selectedModel: string | null;
  readonly providerModel: string | null;
  readonly selectedEffort: EffortLevel | null;
  readonly resultSummary: string;
  readonly patchPath: string | null;
  readonly worktreePath: string | null;
  readonly validationInstructions: string | null;
  readonly failure: StructuredFailure | null;
  readonly escalationHistory: readonly PriorModelAttempt[];
}

export type BlockedCode =
  | "packet_invalid"
  | "routing_stopped"
  | "unsupported_model"
  | "unsupported_effort"
  | "duplicate_execution_in_flight";

export interface BlockedDetail {
  readonly code: BlockedCode;
  /** Present when the block originated from the FACTORY-A1-001 router. */
  readonly routingStopCode?: RoutingStopCode;
  readonly reasons: readonly string[];
  readonly alternatives: readonly string[];
}

/**
 * The single deterministic artifact the connector returns. When it reaches the
 * `handed_off` state it carries a valid, unchanged Operator v0.1 handoff.
 */
export interface ConnectorArtifact {
  readonly schemaVersion: "0.1";
  readonly taskPacketId: string;
  readonly runId: string;
  readonly state: RunState;
  readonly adapter: string;
  readonly selectionReasons: readonly string[];
  readonly capture: ExecutionCapture;
  readonly handoff: OperatorHandoff | null;
  readonly blocked: BlockedDetail | null;
  /** Automatic merge is structurally impossible; this is always false. */
  readonly automaticMerge: false;
  readonly ownerReport: string;
}

/** Handoff controls the Owner-approved packet supplies for the Operator task. */
export interface HandoffControls {
  readonly branchName: string;
  readonly commitMessage: string;
  readonly createPullRequest: boolean;
  readonly forbiddenPaths: readonly string[];
  readonly validationProfile: "full" | "quick";
  readonly validationMode: "dry-run" | "validate-only";
}

/** Execution specification the Owner-approved packet supplies. */
export interface ExecutionSpec {
  readonly prompt: string;
  readonly workingDirectory: string;
  readonly allowedScope: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly timeoutMs: number;
  readonly expectedResultFormat: ExpectedResultFormat;
  readonly stopCondition: string;
  readonly expectedBaseCommit: string;
}

/**
 * One Owner-approved Task Packet as accepted by the connector. It bundles the
 * exact FACTORY-A1-001 routing metadata with the execution spec and handoff
 * controls; the connector never reinterprets the routing metadata.
 */
export interface ExecutionConnectorPacket {
  readonly routing: TaskPacketRoutingMetadata;
  readonly execution: ExecutionSpec;
  readonly handoff: HandoffControls;
}

export type { AttemptFailureClass, PriorModelAttempt };
