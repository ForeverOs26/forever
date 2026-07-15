import type { ConnectorArtifact } from "../execution-connector";

/**
 * Run-lock contract and in-memory implementation for Continue Forever.
 *
 * Idempotency and duplicate-execution prevention are enforced through an
 * atomic acquire: exactly one caller may claim a deterministic run id for
 * execution. The durable, cross-process implementation lives in
 * `atomic-lock.ts` (an OS filesystem atomic primitive); this module defines the
 * contract and a single-process in-memory store used by the hermetic tests.
 *
 * Elapsed time never authorizes a duplicate execution. A running claim of
 * uncertain ownership is not auto-reclaimed; it parks for explicit Owner
 * recovery.
 */

/** Persisted lock lifecycle states. */
export type LockState = "running" | "succeeded" | "handed_off" | "failed";

/** Owner of a running claim, used to distinguish a live run from a stale one. */
export interface OwnerInfo {
  readonly pid: number;
  readonly host: string;
}

export interface LockRecord {
  readonly runId: string;
  readonly taskPacketId: string;
  readonly state: LockState;
  /** ISO timestamp the record was stamped (injected clock / acquisition time). */
  readonly stampedAt: string;
  /** Stored terminal artifact, present once the run reaches a terminal state. */
  readonly artifact: ConnectorArtifact | null;
  /** Present for a running claim. */
  readonly owner?: OwnerInfo | null;
}

/**
 * Health of a lock store's backing state. A durable store reports `ok: false`
 * when its terminal state is corrupt (unreadable, malformed, invalid shape,
 * duplicate run ids, or an unsupported schema version) so the command fails
 * closed before any provider execution instead of treating corruption as empty.
 */
export type LockStoreHealth =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly path?: string };

export interface AcquireOptions {
  readonly runId: string;
  readonly taskPacketId: string;
  readonly now: string;
  /** Explicit Owner retry of a previously failed run. Never automatic. */
  readonly retry: boolean;
  /** Explicit Owner recovery of a stale running claim. Never automatic. */
  readonly recover: boolean;
}

/**
 * The single deterministic outcome of an atomic acquire attempt. Only
 * `acquired` permits the caller to invoke the provider; every other outcome
 * fails closed without execution.
 */
export type AcquireResult =
  | { readonly outcome: "acquired"; readonly note?: string }
  | { readonly outcome: "already_running"; readonly record: LockRecord }
  | { readonly outcome: "stale"; readonly record: LockRecord; readonly note: string }
  | { readonly outcome: "replay"; readonly record: LockRecord }
  | { readonly outcome: "failed_locked"; readonly record: LockRecord };

export interface LockStore {
  /** Atomically claim the run for execution, or report why it cannot be claimed. */
  acquire(options: AcquireOptions): AcquireResult;
  /** Persist a terminal outcome durably and release the running claim. */
  finalize(
    runId: string,
    taskPacketId: string,
    state: Exclude<LockState, "running">,
    now: string,
    artifact: ConnectorArtifact,
  ): void;
  /** Release a running claim without a terminal record (pre-execution block). */
  release(runId: string): void;
  /** Optional terminal-state health check. A store without one is always healthy. */
  health?(): LockStoreHealth;
}

/**
 * Default single-process in-memory lock store. JavaScript's single-threaded
 * execution makes its map operations atomic within one process; the durable
 * cross-process guarantee is provided by `atomic-lock.ts`. A running claim is
 * treated as live (owned by this process) and is never reported stale here.
 */
export class InMemoryLockStore implements LockStore {
  private readonly records = new Map<string, LockRecord>();

  acquire(options: AcquireOptions): AcquireResult {
    const existing = this.records.get(options.runId);
    if (existing) {
      if (existing.state === "succeeded" || existing.state === "handed_off") {
        return { outcome: "replay", record: existing };
      }
      if (existing.state === "failed") {
        if (!options.retry) return { outcome: "failed_locked", record: existing };
        // explicit retry: fall through and re-claim.
      } else if (existing.state === "running") {
        if (!options.recover) return { outcome: "already_running", record: existing };
        // explicit recovery: fall through and re-claim.
      }
    }
    this.records.set(options.runId, {
      runId: options.runId,
      taskPacketId: options.taskPacketId,
      state: "running",
      stampedAt: options.now,
      artifact: null,
      owner: { pid: 0, host: "in-memory" },
    });
    return { outcome: "acquired" };
  }

  finalize(
    runId: string,
    taskPacketId: string,
    state: Exclude<LockState, "running">,
    now: string,
    artifact: ConnectorArtifact,
  ): void {
    this.records.set(runId, { runId, taskPacketId, state, stampedAt: now, artifact });
  }

  release(runId: string): void {
    this.records.delete(runId);
  }

  health(): LockStoreHealth {
    return { ok: true };
  }
}

/** Current durable lock-file schema version. Bumped only on a breaking change. */
export const LOCK_SCHEMA_VERSION = "2";

const LOCK_STATES: ReadonlySet<string> = new Set<LockState>([
  "running",
  "succeeded",
  "handed_off",
  "failed",
]);

/** The on-disk durable terminal payload: a versioned envelope around records. */
export interface LockFilePayload {
  readonly schemaVersion: string;
  readonly records: readonly LockRecord[];
}

export type LockParseResult =
  | { readonly ok: true; readonly records: LockRecord[] }
  | { readonly ok: false; readonly reason: string };

function isValidRecordShape(value: unknown): value is LockRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.runId === "string" &&
    record.runId.length > 0 &&
    typeof record.taskPacketId === "string" &&
    record.taskPacketId.length > 0 &&
    typeof record.state === "string" &&
    LOCK_STATES.has(record.state) &&
    typeof record.stampedAt === "string" &&
    record.stampedAt.length > 0 &&
    (record.artifact === null || typeof record.artifact === "object")
  );
}

/**
 * Parse and validate a durable lock-file string. Fails closed on malformed
 * JSON, an unsupported schema version, a non-array record set, an invalid
 * record shape, or duplicate run ids. It never repairs or drops anything: a
 * single problem rejects the whole file so the command can park for the Owner.
 */
export function parseLockPayload(raw: string): LockParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "Lock file is not valid JSON." };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      reason: "Lock file must be a versioned object { schemaVersion, records }.",
    };
  }
  const payload = parsed as Record<string, unknown>;
  if (payload.schemaVersion !== LOCK_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `Unsupported lock schema version ${JSON.stringify(payload.schemaVersion)}; expected "${LOCK_SCHEMA_VERSION}".`,
    };
  }
  if (!Array.isArray(payload.records)) {
    return { ok: false, reason: "Lock file records must be an array." };
  }
  const records: LockRecord[] = [];
  const seen = new Set<string>();
  for (const entry of payload.records) {
    if (!isValidRecordShape(entry)) {
      return { ok: false, reason: "Lock file contains an invalid run-state record." };
    }
    if (seen.has(entry.runId)) {
      return { ok: false, reason: `Lock file contains a duplicate run id "${entry.runId}".` };
    }
    seen.add(entry.runId);
    records.push(entry);
  }
  return { ok: true, records };
}

/** Serialize records into the versioned durable payload. */
export function serializeLockPayload(records: readonly LockRecord[]): string {
  const payload: LockFilePayload = { schemaVersion: LOCK_SCHEMA_VERSION, records };
  return JSON.stringify(payload, null, 2);
}
