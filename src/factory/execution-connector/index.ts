/**
 * FACTORY-A1-002 Execution Connector public surface.
 *
 * The connector automates the transport and execution mechanics between an
 * approved Task Packet and the existing Forever Operator handoff. It uses the
 * FACTORY-A1-001 router as the single routing source of truth and invokes no
 * project priorities of its own.
 */
export {
  runExecutionConnector,
  type ConnectorRuntime,
  type RunConnectorOptions,
} from "./connector";
export {
  PROVIDER_MODEL_MAP,
  resolveProviderModel,
  type AdapterCapability,
  type AdapterFailureClass,
  type AdapterResult,
  type BlockedCode,
  type BlockedDetail,
  type ConnectorArtifact,
  type ExecutionCapture,
  type ExecutionConnectorPacket,
  type ExecutionRequest,
  type ExecutionSpec,
  type ExpectedResultFormat,
  type HandoffControls,
  type ProviderAdapter,
  type RunState,
  type StructuredFailure,
} from "./contracts";
export {
  deriveRunId,
  InMemoryRunStore,
  REPLAYABLE_STATES,
  type RunRecord,
  type RunStore,
} from "./run-store";
export { redactEvidence, redactSecrets, REDACTION_MARKER } from "./redaction";
export {
  FakeClaudeAdapter,
  type FakeAdapterOptions,
  type FakeOutcome,
} from "./adapters/fake-adapter";
export {
  buildClaudeArgs,
  buildGuardrailPrompt,
  ClaudeCodeAdapter,
  CLAUDE_CLI_BINARY,
  type ClaudeCodeAdapterOptions,
  type ProcessRunner,
  type ProcessRunResult,
} from "./adapters/claude-code-adapter";
// The concrete node process runner (`createNodeProcessRunner`) is intentionally
// not re-exported here: it imports `node:child_process` and is used only for
// gated live proving. Import it directly from
// `./adapters/node-process-runner` when a real Claude execution is authorized.
