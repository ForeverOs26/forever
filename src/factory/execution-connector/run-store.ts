import type { ConnectorArtifact, ExecutionConnectorPacket, RunState } from "./contracts";

/**
 * Deterministic run identity and idempotency store.
 *
 * The same approved Task Packet must not be executed twice by accident. A run
 * id is derived deterministically from the packet's identity and execution
 * content, so an identical resubmission maps to the same id and returns the
 * stored result instead of launching a duplicate provider run. A run still in
 * the `running` state fails closed.
 */

/** Stable JSON with sorted keys, so semantically identical packets hash alike. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

/**
 * FNV-1a 32-bit hash rendered as 8 hex chars. A cryptographic digest is not
 * required for an idempotency key; determinism is. Kept dependency-free so the
 * module stays bundler-neutral, matching the rest of `src/factory`.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts, kept in the unsigned 32-bit range.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The identity-relevant projection of a packet. Prior model attempts are
 * included so that a genuine re-route after a failure is a new run, while an
 * identical resubmission is deduplicated.
 */
function runIdentity(packet: ExecutionConnectorPacket): string {
  const { routing, execution } = packet;
  return stableStringify({
    taskPacketId: routing.taskPacketId,
    approvalState: routing.approvalState,
    riskClass: routing.riskClass,
    ambiguity: routing.ambiguity,
    evidenceSensitivity: routing.evidenceSensitivity,
    gateBlindness: routing.gateBlindness,
    requestedEffort: routing.requestedEffort ?? null,
    fableAuthorization: routing.fableAuthorization ?? null,
    maxAuthorization: routing.maxAuthorization ?? null,
    priorModelAttempts: routing.priorModelAttempts,
    prompt: execution.prompt,
    allowedScope: [...execution.allowedScope].sort(),
    expectedBaseCommit: execution.expectedBaseCommit,
    expectedResultFormat: execution.expectedResultFormat,
  });
}

/** Deterministic run id: `<taskPacketId>-<8 hex>`. */
export function deriveRunId(packet: ExecutionConnectorPacket): string {
  return `${packet.routing.taskPacketId}-${fnv1a(runIdentity(packet))}`;
}

export interface RunRecord {
  readonly runId: string;
  readonly taskPacketId: string;
  readonly state: RunState;
  /** Present once the run reaches a terminal or blocked state. */
  readonly artifact: ConnectorArtifact | null;
}

export interface RunStore {
  get(runId: string): RunRecord | undefined;
  put(record: RunRecord): void;
}

/** Default in-memory store. A durable store may implement the same interface. */
export class InMemoryRunStore implements RunStore {
  private readonly records = new Map<string, RunRecord>();

  get(runId: string): RunRecord | undefined {
    return this.records.get(runId);
  }

  put(record: RunRecord): void {
    this.records.set(record.runId, record);
  }
}

/** Terminal/replayable states: a completed or blocked run returns its result. */
export const REPLAYABLE_STATES: ReadonlySet<RunState> = new Set<RunState>([
  "succeeded",
  "failed",
  "handed_off",
  "blocked",
]);
