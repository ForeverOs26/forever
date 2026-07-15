/**
 * FACTORY-A1-003 Continue Forever public surface.
 *
 * Continue Forever is the deterministic command that removes the Owner from the
 * manual execution-transfer loop for exactly one already-approved Task Packet.
 * It reuses the unchanged FACTORY-A1-001 router and FACTORY-A1-002 Execution
 * Connector; it invents no new objective, enables no automatic merge, and never
 * starts a next task.
 */
export { continueForever, type ContinueForeverDeps } from "./continue-forever";
export {
  evaluateOperatorTaskObject,
  reconcileOperatorState,
  resolveCurrentTask,
  SourceReadError,
  type CurrentTaskResolution,
  type OperatorReconcileResult,
  type OperatorTaskState,
} from "./current-task-resolver";
export { buildFinalReport, buildStopReport, renderFinalReport } from "./report";
export {
  InMemoryLockStore,
  LOCK_SCHEMA_VERSION,
  parseLockPayload,
  serializeLockPayload,
  type AcquireOptions,
  type AcquireResult,
  type LockFilePayload,
  type LockParseResult,
  type LockRecord,
  type LockState,
  type LockStore,
  type LockStoreHealth,
  type OwnerInfo,
} from "./run-lock";
export { AtomicFileLockStore } from "./atomic-lock";
export { HERMETIC_TEST_MARKER } from "./contracts";
export type {
  ArtifactLocation,
  ContinueFinalState,
  ContinueResult,
  ContinueStopCode,
  CurrentTaskEnvelope,
  ExecutionMode,
  FinalReport,
  PublishingAction,
  PublishingAuthorization,
  PublishingDecision,
} from "./contracts";
