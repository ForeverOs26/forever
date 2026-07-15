import { describe, expect, it } from "vitest";
import {
  InMemoryLockStore,
  LOCK_SCHEMA_VERSION,
  parseLockPayload,
  serializeLockPayload,
  type LockRecord,
} from "./run-lock";
import type { ConnectorArtifact } from "../execution-connector";

const RUN_ID = "FACTORY-A1-003-TEST-abc12345";
const TASK = "FACTORY-A1-003-TEST";
const T0 = "2026-07-14T00:00:00.000Z";

function fakeArtifact(state: ConnectorArtifact["state"]): ConnectorArtifact {
  return {
    schemaVersion: "0.1",
    taskPacketId: TASK,
    runId: RUN_ID,
    state,
    adapter: "fake-claude",
    selectionReasons: [],
    capture: {
      providerExecutionId: "fake-exec",
      startedAt: T0,
      finishedAt: T0,
      exitStatus: 0,
      selectedTier: "engineering",
      selectedModel: "Claude Opus 4.8",
      providerModel: "claude-opus-4-8",
      selectedEffort: "medium",
      resultSummary: "ok",
      patchPath: null,
      worktreePath: null,
      validationInstructions: null,
      failure: null,
      escalationHistory: [],
    },
    handoff: null,
    blocked: null,
    automaticMerge: false,
    ownerReport: "ok",
  };
}

const opts = (over: Partial<Parameters<InMemoryLockStore["acquire"]>[0]> = {}) => ({
  runId: RUN_ID,
  taskPacketId: TASK,
  now: T0,
  retry: false,
  recover: false,
  ...over,
});

describe("InMemoryLockStore (single-process atomic acquire)", () => {
  it("acquires an unheld run", () => {
    expect(new InMemoryLockStore().acquire(opts()).outcome).toBe("acquired");
  });

  it("reports already_running for a held run", () => {
    const store = new InMemoryLockStore();
    store.acquire(opts());
    expect(store.acquire(opts()).outcome).toBe("already_running");
  });

  it("replays a completed terminal run without re-acquiring", () => {
    const store = new InMemoryLockStore();
    store.acquire(opts());
    store.finalize(RUN_ID, TASK, "handed_off", T0, fakeArtifact("handed_off"));
    expect(store.acquire(opts()).outcome).toBe("replay");
  });

  it("keeps a failed run locked without an explicit retry", () => {
    const store = new InMemoryLockStore();
    store.acquire(opts());
    store.finalize(RUN_ID, TASK, "failed", T0, fakeArtifact("failed"));
    expect(store.acquire(opts()).outcome).toBe("failed_locked");
  });

  it("re-acquires a failed run only on explicit retry", () => {
    const store = new InMemoryLockStore();
    store.acquire(opts());
    store.finalize(RUN_ID, TASK, "failed", T0, fakeArtifact("failed"));
    expect(store.acquire(opts({ retry: true })).outcome).toBe("acquired");
  });

  it("re-acquires a released run", () => {
    const store = new InMemoryLockStore();
    store.acquire(opts());
    store.release(RUN_ID);
    expect(store.acquire(opts()).outcome).toBe("acquired");
  });

  it("re-acquires a running run only on explicit recovery", () => {
    const store = new InMemoryLockStore();
    store.acquire(opts());
    expect(store.acquire(opts({ recover: true })).outcome).toBe("acquired");
  });

  it("reports healthy", () => {
    expect(new InMemoryLockStore().health()).toEqual({ ok: true });
  });
});

describe("parseLockPayload (durable run-state fails closed)", () => {
  const record: LockRecord = {
    runId: RUN_ID,
    taskPacketId: TASK,
    state: "handed_off",
    stampedAt: T0,
    artifact: null,
  };

  it("round-trips a valid versioned payload", () => {
    const raw = serializeLockPayload([record]);
    const parsed = parseLockPayload(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.records[0].runId).toBe(RUN_ID);
    expect(JSON.parse(raw).schemaVersion).toBe(LOCK_SCHEMA_VERSION);
  });

  it("rejects malformed JSON", () => {
    expect(parseLockPayload("{ not json").ok).toBe(false);
  });

  it("rejects a bare array (legacy/unsupported shape)", () => {
    expect(parseLockPayload(JSON.stringify([record])).ok).toBe(false);
  });

  it("rejects an unsupported schema version", () => {
    const parsed = parseLockPayload(JSON.stringify({ schemaVersion: "999", records: [record] }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("schema version");
  });

  it("rejects a non-array records field", () => {
    expect(parseLockPayload(JSON.stringify({ schemaVersion: "2", records: {} })).ok).toBe(false);
  });

  it("rejects an invalid record shape", () => {
    const raw = JSON.stringify({ schemaVersion: "2", records: [{ runId: "x", state: "bogus" }] });
    expect(parseLockPayload(raw).ok).toBe(false);
  });

  it("rejects duplicate run ids", () => {
    const parsed = parseLockPayload(
      JSON.stringify({ schemaVersion: "2", records: [record, record] }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("duplicate run id");
  });
});
