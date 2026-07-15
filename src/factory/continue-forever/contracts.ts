import type { ConnectorArtifact, ExecutionConnectorPacket } from "../execution-connector";
import type { EffortLevel, WorkerTier } from "../routing-table";
import type { RoutingStopCode } from "../model-router";

/**
 * FACTORY-A1-003 — Continue Forever command contracts.
 *
 * The Continue Forever command is the first deterministic entry point that
 * removes the Owner from the manual execution-transfer loop for exactly one
 * already-approved Task Packet. It resolves that single current packet, runs it
 * through the unchanged FACTORY-A1-001 router and FACTORY-A1-002 Execution
 * Connector, prepares the existing Operator-compatible handoff, and produces one
 * owner-visible final report — then stops without starting any next task.
 *
 * These types are provider- and storage-neutral. The command invents no project
 * priorities, approves no packet, enables no automatic merge, and never infers
 * publishing permission from the phrase "Continue Forever".
 */

/**
 * One entry in the current-task source. The envelope wraps a full
 * {@link ExecutionConnectorPacket} with the small amount of governance state the
 * command needs to fail closed: whether the packet is the current one, whether
 * it has been superseded, and the explicit publishing authorization (if any).
 */
export interface CurrentTaskEnvelope {
  /** Only packets explicitly marked current are considered by the resolver. */
  readonly isCurrent: boolean;
  /** Present when the packet has been superseded by a newer task id. */
  readonly supersededBy?: string | null;
  /**
   * Explicit publishing authorization. Absent (or `authorized: false`) means no
   * commit, push, or pull request may be performed; the command stops with
   * OWNER_APPROVAL_REQUIRED before any publishing step. Authorization is never
   * inferred from the command name.
   */
  readonly publishing?: PublishingAuthorization;
  readonly packet: ExecutionConnectorPacket;
}

/** Explicit, Owner-supplied publishing authorization for a Task Packet. */
export interface PublishingAuthorization {
  readonly authorized: boolean;
  /** Durable Owner authorization record (e.g. a packet approval citation). */
  readonly authorizationRecord?: string;
  /** The exact Git actions the Owner authorized. */
  readonly actions?: readonly PublishingAction[];
}

export type PublishingAction = "commit" | "push" | "pull_request";

/** Coded fail-closed stop outcomes of the Continue Forever command. */
export type ContinueStopCode =
  | "NO_CURRENT_TASK"
  | "CURRENT_TASK_NOT_APPROVED"
  | "MULTIPLE_CURRENT_TASKS"
  | "CURRENT_TASK_ALREADY_RUNNING"
  | "CURRENT_TASK_ALREADY_COMPLETED"
  | "CURRENT_TASK_SUPERSEDED"
  | "CURRENT_TASK_INVALID"
  | "ROUTER_BLOCKED"
  | "EXECUTION_BLOCKED"
  | "EXECUTION_FAILED"
  | "OPERATOR_HANDOFF_BLOCKED"
  | "FAILED_REQUIRES_RETRY"
  | "OWNER_APPROVAL_REQUIRED"
  | "LIVE_EXECUTION_UNAVAILABLE"
  | "CORRUPT_RUN_STATE"
  | "CURRENT_TASK_STATE_CONFLICT"
  | "CURRENT_TASK_STATE_INVALID"
  | "STALE_RUN_REQUIRES_OWNER_RECOVERY";

/**
 * Which provider adapter actually executed. `live` is the real Claude Code
 * adapter (the production default); `fake` is the hermetic, TEST_ONLY adapter.
 * The final report always records this so a hermetic run can never be mistaken
 * for proof that a real Forever task was completed.
 */
export type ExecutionMode = "live" | "fake";

/** Marker embedded in every fake-mode report so it is never mistaken for live. */
export const HERMETIC_TEST_MARKER = "HERMETIC_TEST (TEST_ONLY — not a real Forever execution)";

/** Terminal state of a Continue Forever run, mirrored in the final report. */
export type ContinueFinalState =
  | "handed_off"
  | "succeeded_report_only"
  | "already_running"
  | "completed_replay"
  | "failed"
  | "blocked";

/** The publishing decision the command reached for this run. */
export type PublishingDecision =
  | { readonly mode: "prepare-only"; readonly reason: string }
  | {
      readonly mode: "authorized-prepared";
      readonly authorizationRecord: string;
      readonly actions: readonly PublishingAction[];
    }
  | {
      readonly mode: "blocked";
      readonly code: "OWNER_APPROVAL_REQUIRED";
      readonly requested: readonly PublishingAction[];
      readonly reason: string;
    };

/**
 * The single owner-visible final report. It is a structured object so callers
 * can assert on it deterministically; {@link renderFinalReport} produces the
 * concise text a human reads. Secrets and provider session ids are never
 * present — every free-text field is sourced from already-redacted connector
 * output or from static command text.
 */
export interface FinalReport {
  readonly taskPacketId: string;
  readonly missionTitle: string;
  readonly finalState: ContinueFinalState;
  readonly stopCode: ContinueStopCode | null;
  /** Which adapter executed: `live` (real Claude Code) or `fake` (TEST_ONLY). */
  readonly executionMode: ExecutionMode;
  readonly selectedModel: string | null;
  readonly selectedEffort: EffortLevel | null;
  readonly selectedTier: WorkerTier | null;
  readonly modelSelectionReasons: readonly string[];
  readonly executionResult: string;
  readonly operatorHandoffStatus: string;
  readonly validationGateStatus: string;
  readonly artifactLocation: ArtifactLocation | null;
  readonly publishingState: string;
  readonly blockers: readonly string[];
  readonly ownerApprovalAction: string | null;
  readonly nextTaskStarted: false;
  readonly automaticMerge: false;
  /** The full connector artifact when a run reached the connector, else null. */
  readonly connectorArtifact: ConnectorArtifact | null;
}

/** Branch / worktree / patch location, present only when the run produced one. */
export interface ArtifactLocation {
  readonly branchName: string | null;
  readonly worktreePath: string | null;
  readonly patchPath: string | null;
}

/** The result of one Continue Forever invocation. */
export interface ContinueResult {
  readonly report: FinalReport;
  /** The deterministic run id, present once a current packet was resolved. */
  readonly runId: string | null;
  /** Convenience flag: `true` only for a fully successful handed-off run. */
  readonly handedOff: boolean;
}

export type { RoutingStopCode };
