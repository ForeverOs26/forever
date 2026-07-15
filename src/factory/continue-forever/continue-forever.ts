import {
  deriveRunId,
  InMemoryRunStore,
  runExecutionConnector,
  type ConnectorArtifact,
  type ExecutionConnectorPacket,
  type ProviderAdapter,
} from "../execution-connector";
import type {
  ContinueFinalState,
  ContinueResult,
  ContinueStopCode,
  CurrentTaskEnvelope,
  ExecutionMode,
  FinalReport,
  PublishingAction,
  PublishingDecision,
} from "./contracts";
import {
  reconcileOperatorState,
  resolveCurrentTask,
  SourceReadError,
  type OperatorTaskState,
} from "./current-task-resolver";
import { buildFinalReport, buildStopReport } from "./report";
import { InMemoryLockStore, type LockState, type LockStore } from "./run-lock";

/**
 * FACTORY-A1-003 — Continue Forever command orchestrator.
 *
 * Deterministic flow: resolve the single current approved Task Packet, reconcile
 * canonical state, fail closed on corrupt run state, confirm live availability,
 * atomically acquire the run, run it through the unchanged FACTORY-A1-001 router
 * and FACTORY-A1-002 Execution Connector, prepare the existing Operator handoff,
 * produce one owner-visible final report, release the lock, and stop — without
 * starting any next task. It resolves exactly one packet, never invents a new
 * objective, never enables automatic merge, and never infers publishing
 * permission from the command name.
 */

export interface ContinueForeverDeps {
  /**
   * The current-task source: the array itself or a lazy provider of it. The
   * provider may throw {@link SourceReadError} for an unreadable/malformed
   * CONTINUE_TASK.json; the orchestrator maps that to a structured
   * CURRENT_TASK_INVALID stop rather than a top-level exception.
   */
  readonly source: readonly CurrentTaskEnvelope[] | (() => readonly CurrentTaskEnvelope[]);
  /** The provider adapter (real Claude Code in production; hermetic fake for tests). */
  readonly adapter: ProviderAdapter;
  /**
   * Which adapter this is. Recorded verbatim in the report. When omitted it is
   * inferred from the adapter capability name (a `fake*` name → `fake`), so a
   * hermetic run is always visibly marked and never mistaken for a live one.
   */
  readonly executionMode?: ExecutionMode;
  /**
   * Live-mode availability probe. It reports only whether the real Claude Code
   * binary is resolvable — it does NOT prove authentication. In live mode, if it
   * reports unavailable, the command fails closed with LIVE_EXECUTION_UNAVAILABLE
   * before any provider call. There is never an automatic fallback to the fake
   * adapter. Authentication is confirmed only by a real execution: a recognized
   * auth/login failure at runtime is also mapped to LIVE_EXECUTION_UNAVAILABLE.
   */
  readonly probeAvailability?: () =>
    | { available: boolean; reason?: string }
    | Promise<{ available: boolean; reason?: string }>;
  /**
   * The strict state of the Operator canonical `CURRENT_TASK.json`. `absent`
   * allows the run; a `valid` differing id fails closed with
   * CURRENT_TASK_STATE_CONFLICT; an `invalid` file fails closed with
   * CURRENT_TASK_STATE_INVALID (never a silent skip).
   */
  readonly operatorTaskState?: OperatorTaskState;
  /** Durable, atomic lock store; defaults to an in-memory store for one process. */
  readonly lockStore?: LockStore;
  /** Injected clock keeps run identity and timestamps deterministic under test. */
  readonly now?: () => string;
  /** Explicit Owner retry of a previously failed packet revision. Never automatic. */
  readonly retry?: boolean;
  /** Explicit Owner recovery of a stale running claim. Never automatic. */
  readonly recover?: boolean;
}

function readSource(source: ContinueForeverDeps["source"]): readonly CurrentTaskEnvelope[] {
  return typeof source === "function" ? source() : source;
}

/** Infer the execution mode from the adapter when not explicitly supplied. */
function resolveExecutionMode(deps: ContinueForeverDeps): ExecutionMode {
  if (deps.executionMode) return deps.executionMode;
  return /^fake/i.test(deps.adapter.capability.name) ? "fake" : "live";
}

/** Derive which Git actions a prepared handoff would eventually cause. */
function requestedPublishingActions(packet: ExecutionConnectorPacket): PublishingAction[] {
  return packet.handoff.createPullRequest ? ["commit", "push", "pull_request"] : [];
}

/** Decide the publishing posture; publishing is never inferred from the command. */
function decidePublishing(envelope: CurrentTaskEnvelope): PublishingDecision {
  const requested = requestedPublishingActions(envelope.packet);
  if (requested.length === 0) {
    return {
      mode: "prepare-only",
      reason: "The packet requests no commit, push, or pull request.",
    };
  }
  const auth = envelope.publishing;
  if (auth?.authorized === true && auth.authorizationRecord) {
    return {
      mode: "authorized-prepared",
      authorizationRecord: auth.authorizationRecord,
      actions: auth.actions && auth.actions.length > 0 ? auth.actions : requested,
    };
  }
  return {
    mode: "blocked",
    code: "OWNER_APPROVAL_REQUIRED",
    requested,
    reason:
      "The packet would publish, but no explicit Owner publishing authorization record is present. " +
      "Continue Forever never infers publishing permission from its own invocation.",
  };
}

/** Recognizes an authentication/login failure in an adapter failure message. */
const AUTH_FAILURE_PATTERN =
  /\b(unauthenticated|unauthorized|not logged in|please run\s+\/login|\/login\b|invalid api key|authentication (failed|required)|401|403|credit balance|log ?in required)\b/i;

/** Map the connector artifact to a Continue final state and optional stop code. */
function classifyArtifact(
  artifact: ConnectorArtifact,
  packet: ExecutionConnectorPacket,
  executionMode: ExecutionMode,
): { finalState: ContinueFinalState; stopCode: ContinueStopCode | null } {
  if (artifact.blocked) {
    switch (artifact.blocked.code) {
      case "routing_stopped":
        return { finalState: "blocked", stopCode: "ROUTER_BLOCKED" };
      case "unsupported_model":
      case "unsupported_effort":
        return { finalState: "blocked", stopCode: "EXECUTION_BLOCKED" };
      case "duplicate_execution_in_flight":
        return { finalState: "blocked", stopCode: "CURRENT_TASK_ALREADY_RUNNING" };
      case "packet_invalid":
        return { finalState: "blocked", stopCode: "CURRENT_TASK_INVALID" };
    }
  }
  if (artifact.state === "handed_off") {
    return { finalState: "handed_off", stopCode: null };
  }
  if (artifact.state === "failed") {
    // In live mode, a launch (environment) failure or a recognized
    // authentication/login failure means the real adapter could not execute:
    // surface it as unavailable rather than a generic execution failure. Never
    // fall back to the fake adapter and never simulate success.
    if (executionMode === "live") {
      const failure = artifact.capture.failure;
      const message = `${failure?.message ?? ""} ${artifact.capture.resultSummary ?? ""}`;
      if (failure?.failureClass === "environment" || AUTH_FAILURE_PATTERN.test(message)) {
        return { finalState: "failed", stopCode: "LIVE_EXECUTION_UNAVAILABLE" };
      }
    }
    return { finalState: "failed", stopCode: "EXECUTION_FAILED" };
  }
  // succeeded: report-only has no patch to hand off; a patch with no handoff was rejected.
  if (packet.execution.expectedResultFormat === "report") {
    return { finalState: "succeeded_report_only", stopCode: null };
  }
  return { finalState: "blocked", stopCode: "OPERATOR_HANDOFF_BLOCKED" };
}

const LOCK_STATE_BY_FINAL: Partial<Record<ContinueFinalState, Exclude<LockState, "running">>> = {
  handed_off: "handed_off",
  succeeded_report_only: "succeeded",
  failed: "failed",
};

function result(report: FinalReport, runId: string | null): ContinueResult {
  return { report, runId, handedOff: report.finalState === "handed_off" };
}

/**
 * Run the Continue Forever command once. Returns exactly one structured result
 * carrying the single owner-visible final report. The same current packet
 * revision run concurrently never launches a duplicate provider execution: the
 * atomic lock lets exactly one caller acquire the run, the loser reports
 * already-running, a completed run replays its stored result, a failed run
 * requires an explicit retry, and a stale claim parks for explicit Owner
 * recovery (elapsed time alone never authorizes a duplicate).
 */
export async function continueForever(deps: ContinueForeverDeps): Promise<ContinueResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const lockStore = deps.lockStore ?? new InMemoryLockStore();
  const executionMode = resolveExecutionMode(deps);

  // 2. Read the source (fail closed on an unreadable/malformed source file),
  // then resolve the single current approved packet.
  let envelopes: readonly CurrentTaskEnvelope[];
  try {
    envelopes = readSource(deps.source);
  } catch (error) {
    const reason =
      error instanceof SourceReadError
        ? error.message
        : `Could not read the current-task source: ${error instanceof Error ? error.message : String(error)}`;
    return result(
      buildStopReport({
        stopCode: "CURRENT_TASK_INVALID",
        reasons: [reason],
        executionMode,
        taskPacketId: "unresolved",
        missionTitle: "Continue Forever — current task resolution",
      }),
      null,
    );
  }

  const resolution = resolveCurrentTask(envelopes);
  if (!resolution.ok) {
    const report = buildStopReport({
      stopCode: resolution.code,
      reasons: resolution.reasons,
      executionMode,
      taskPacketId:
        resolution.code === "MULTIPLE_CURRENT_TASKS"
          ? "multiple"
          : resolution.code === "NO_CURRENT_TASK"
            ? "none"
            : "unresolved",
      missionTitle: "Continue Forever — current task resolution",
    });
    return result(report, null);
  }

  const envelope = resolution.envelope;
  const packet = envelope.packet;
  const missionTitle = packet.routing.title;

  // 2b. One authoritative Task Packet identity: reconcile the Continue source
  // with the strict Operator canonical CURRENT_TASK.json state. Invalid or
  // conflicting Operator state fails closed before lock, routing, and adapter.
  const identity = reconcileOperatorState(
    packet.routing.taskPacketId,
    deps.operatorTaskState ?? { status: "absent" },
  );
  if (!identity.ok) {
    return result(
      buildStopReport({
        stopCode: identity.code,
        reasons: identity.reasons,
        executionMode,
        taskPacketId: packet.routing.taskPacketId,
        missionTitle,
        ownerApprovalAction:
          "Reconcile CONTINUE_TASK.json and the Operator CURRENT_TASK.json to a single, valid, " +
          "authoritative Task Packet id before re-running; the command will not choose one silently.",
      }),
      null,
    );
  }

  // 2c. Fail closed on corrupt durable run state before any provider execution.
  const health = lockStore.health?.() ?? { ok: true };
  if (!health.ok) {
    return result(
      buildStopReport({
        stopCode: "CORRUPT_RUN_STATE",
        reasons: [
          `Durable run-state is corrupt: ${health.reason}`,
          ...(health.path ? [`Lock file: ${health.path}`] : []),
        ],
        executionMode,
        taskPacketId: packet.routing.taskPacketId,
        missionTitle,
        ownerApprovalAction:
          `Park for Owner review: inspect${health.path ? ` ${health.path}` : " the lock file"} and ` +
          "manually resolve the corrupt run-state. The command never overwrites, deletes, or repairs it.",
      }),
      null,
    );
  }

  // 2d. In live mode, confirm the real binary is resolvable before executing.
  // This proves binary availability, not authentication; there is never an
  // automatic fallback to the fake adapter.
  if (executionMode === "live" && deps.probeAvailability) {
    const availability = await deps.probeAvailability();
    if (!availability.available) {
      return result(
        buildStopReport({
          stopCode: "LIVE_EXECUTION_UNAVAILABLE",
          reasons: [
            `The real Claude Code adapter is unavailable: ${availability.reason ?? "no reason reported"}.`,
            "No fallback to the hermetic fake adapter occurred; success was not simulated.",
          ],
          executionMode,
          taskPacketId: packet.routing.taskPacketId,
          missionTitle,
          ownerApprovalAction:
            "Restore Claude Code availability/authentication, or run with --fake for a hermetic TEST_ONLY execution.",
        }),
        null,
      );
    }
  }

  // 1. Atomically acquire the run. Exactly one concurrent caller may acquire it.
  const runId = deriveRunId(packet);
  const acquisition = lockStore.acquire({
    runId,
    taskPacketId: packet.routing.taskPacketId,
    now: now(),
    retry: deps.retry ?? false,
    recover: deps.recover ?? false,
  });
  const auditNotes: string[] = [];

  if (acquisition.outcome === "already_running") {
    return result(
      buildStopReport({
        stopCode: "CURRENT_TASK_ALREADY_RUNNING",
        reasons: [
          `An execution for run ${runId} is already in progress; refusing a duplicate. No provider call was made.`,
        ],
        executionMode,
        taskPacketId: packet.routing.taskPacketId,
        missionTitle,
      }),
      runId,
    );
  }

  if (acquisition.outcome === "stale") {
    return result(
      buildStopReport({
        stopCode: "STALE_RUN_REQUIRES_OWNER_RECOVERY",
        reasons: [acquisition.note],
        executionMode,
        taskPacketId: packet.routing.taskPacketId,
        missionTitle,
        ownerApprovalAction:
          "Confirm the prior run is truly dead, then re-run with explicit Owner recovery (--recover). " +
          "Continue Forever never reclaims a running lock automatically on elapsed time.",
      }),
      runId,
    );
  }

  if (acquisition.outcome === "replay") {
    const artifact = acquisition.record.artifact as ConnectorArtifact;
    const { finalState } = classifyArtifact(artifact, packet, executionMode);
    return result(
      buildFinalReport({
        finalState: "completed_replay",
        stopCode: null,
        artifact,
        missionTitle,
        executionMode,
        publishing: decidePublishing(envelope),
        auditNotes: [
          `Run ${runId} already completed (${finalState}); returning the stored result without re-executing.`,
        ],
      }),
      runId,
    );
  }

  if (acquisition.outcome === "failed_locked") {
    const artifact = acquisition.record.artifact as ConnectorArtifact;
    return result(
      buildFinalReport({
        finalState: "failed",
        stopCode: "FAILED_REQUIRES_RETRY",
        artifact,
        missionTitle,
        executionMode,
        publishing: decidePublishing(envelope),
        auditNotes: [
          `Run ${runId} previously failed; an explicit Owner retry is required. No automatic retry occurred.`,
        ],
      }),
      runId,
    );
  }

  // acquisition.outcome === "acquired": this caller owns the run.
  if (acquisition.note) auditNotes.push(acquisition.note);
  const publishing = decidePublishing(envelope);

  // 3–8. Invoke the unchanged router + connector; capture and hand off. The lock
  // is released/finalized in `finally` so a crash never leaves a dangling claim
  // without a durable terminal record.
  let artifact: ConnectorArtifact;
  try {
    const runStore = new InMemoryRunStore();
    artifact = await runExecutionConnector(packet, deps.adapter, {
      runtime: { now, store: runStore },
    });
  } catch (error) {
    lockStore.release(runId);
    throw error;
  }

  const { finalState, stopCode } = classifyArtifact(artifact, packet, executionMode);

  // 10. Release / finalize the lock deterministically.
  const lockState = LOCK_STATE_BY_FINAL[finalState];
  if (lockState) {
    lockStore.finalize(runId, packet.routing.taskPacketId, lockState, now(), artifact);
  } else if (finalState === "blocked" && stopCode === "OPERATOR_HANDOFF_BLOCKED") {
    // The provider executed successfully; store as replayable to avoid re-running.
    lockStore.finalize(runId, packet.routing.taskPacketId, "succeeded", now(), artifact);
  } else {
    // A pre-execution block (router/unsupported) launched no provider run; release
    // the claim so the Owner can correct the packet and re-run cleanly.
    lockStore.release(runId);
  }

  // 9. Produce the single owner-visible final report.
  return result(
    buildFinalReport({
      finalState,
      stopCode,
      artifact,
      missionTitle,
      executionMode,
      publishing,
      auditNotes,
    }),
    runId,
  );
}
