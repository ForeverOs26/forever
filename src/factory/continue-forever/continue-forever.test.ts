import { describe, expect, it } from "vitest";
import { continueForever } from "./continue-forever";
import { InMemoryLockStore, type AcquireResult, type LockStore } from "./run-lock";
import { SourceReadError } from "./current-task-resolver";
import { baseEnvelope, fixedClock } from "./test-fixtures";
import { deriveRunId, FakeClaudeAdapter } from "../execution-connector";

const CLOCK = fixedClock(["2026-07-14T00:00:00.000Z"]);

describe("Continue Forever command (FACTORY-A1-003)", () => {
  // 1. no current task → fail closed
  it("1: fails closed when there is no current task", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: [baseEnvelope({ isCurrent: false })],
      adapter,
      now: CLOCK,
    });
    expect(res.report.stopCode).toBe("NO_CURRENT_TASK");
    expect(adapter.executeCount).toBe(0);
    expect(res.report.nextTaskStarted).toBe(false);
  });

  // 2. unapproved current task → fail closed
  it("2: fails closed for an unapproved current task", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: [baseEnvelope({ packet: { routing: { approvalState: "proposed" } } })],
      adapter,
      now: CLOCK,
    });
    expect(res.report.stopCode).toBe("CURRENT_TASK_NOT_APPROVED");
    expect(adapter.executeCount).toBe(0);
  });

  // 3. multiple current tasks → fail closed
  it("3: fails closed with multiple current tasks", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: [
        baseEnvelope({ packet: { routing: { taskPacketId: "FACTORY-A" } } }),
        baseEnvelope({ packet: { routing: { taskPacketId: "FACTORY-B" } } }),
      ],
      adapter,
      now: CLOCK,
    });
    expect(res.report.stopCode).toBe("MULTIPLE_CURRENT_TASKS");
    expect(adapter.executeCount).toBe(0);
  });

  // 4. invalid packet → fail closed
  it("4: fails closed for an invalid packet", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: [baseEnvelope({ packet: { execution: { stopCondition: "" } } })],
      adapter,
      now: CLOCK,
    });
    expect(res.report.stopCode).toBe("CURRENT_TASK_INVALID");
    expect(adapter.executeCount).toBe(0);
  });

  // 5. approved packet → Router invoked
  it("5: routes an approved packet through FACTORY-A1-001", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({ source: [baseEnvelope()], adapter, now: CLOCK });
    expect(res.report.selectedModel).toBe("Claude Sonnet 5.0");
    expect(res.report.modelSelectionReasons.length).toBeGreaterThan(0);
    expect(adapter.executeCount).toBe(1);
  });

  // 6. Router block prevents execution
  it("6: a router block prevents execution", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: [
        baseEnvelope({ packet: { routing: { riskClass: "R3", architecturalImpact: "systemic" } } }),
      ],
      adapter,
      now: CLOCK,
    });
    expect(res.report.stopCode).toBe("ROUTER_BLOCKED");
    expect(adapter.executeCount).toBe(0);
  });

  // 7. exact selected model and effort reach the Execution Connector
  it("7: the exact selected model and effort reach the connector", async () => {
    const adapter = new FakeClaudeAdapter();
    await continueForever({
      source: [
        baseEnvelope({ packet: { routing: { riskClass: "R1", taskComplexity: "complex" } } }),
      ],
      adapter,
      now: CLOCK,
    });
    expect(adapter.requests).toHaveLength(1);
    expect(adapter.requests[0].providerModel).toBe("claude-opus-4-8");
    expect(adapter.requests[0].effort).toBe("high");
  });

  // 8. successful Connector result creates an Operator-compatible handoff
  it("8: a successful result creates a valid Operator handoff", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({ source: [baseEnvelope()], adapter, now: CLOCK });
    expect(res.report.finalState).toBe("handed_off");
    expect(res.handedOff).toBe(true);
    const handoff = res.report.connectorArtifact?.handoff;
    expect(handoff).not.toBeNull();
    expect(handoff?.operatorTask.schemaVersion).toBe("0.1");
    expect(handoff?.operatorTask.allowAutomaticMerge).toBe(false);
  });

  // 9. Operator handoff failure becomes a structured stop
  it("9: an Operator handoff failure becomes a structured stop", async () => {
    const adapter = new FakeClaudeAdapter({
      outcome: { kind: "succeed", patchPath: "outside/bad.patch" },
    });
    const res = await continueForever({ source: [baseEnvelope()], adapter, now: CLOCK });
    expect(res.report.stopCode).toBe("OPERATOR_HANDOFF_BLOCKED");
    expect(res.report.connectorArtifact?.handoff).toBeNull();
  });

  // 10. duplicate invocation does not execute twice
  it("10: a duplicate invocation does not execute twice", async () => {
    const adapter = new FakeClaudeAdapter();
    const lockStore = new InMemoryLockStore();
    const deps = { source: [baseEnvelope()], adapter, lockStore, now: CLOCK };
    await continueForever(deps);
    const second = await continueForever(deps);
    expect(adapter.executeCount).toBe(1);
    expect(second.report.finalState).toBe("completed_replay");
  });

  // 11. active lock returns an already-running state
  it("11: an active lock returns already-running", async () => {
    const adapter = new FakeClaudeAdapter();
    const lockStore = new InMemoryLockStore();
    const envelope = baseEnvelope();
    // Pre-acquire the run to simulate another in-flight process holding it.
    lockStore.acquire({
      runId: deriveRunId(envelope.packet),
      taskPacketId: envelope.packet.routing.taskPacketId,
      now: "2026-07-14T00:00:00.000Z",
      retry: false,
      recover: false,
    });
    const res = await continueForever({ source: [envelope], adapter, lockStore, now: CLOCK });
    expect(res.report.stopCode).toBe("CURRENT_TASK_ALREADY_RUNNING");
    expect(adapter.executeCount).toBe(0);
  });

  // 12. completed task returns the existing result
  it("12: a completed task returns the existing result", async () => {
    const adapter = new FakeClaudeAdapter();
    const lockStore = new InMemoryLockStore();
    const deps = { source: [baseEnvelope()], adapter, lockStore, now: CLOCK };
    const first = await continueForever(deps);
    const replay = await continueForever(deps);
    expect(replay.report.finalState).toBe("completed_replay");
    expect(replay.report.connectorArtifact?.runId).toBe(first.report.connectorArtifact?.runId);
    expect(adapter.executeCount).toBe(1);
  });

  // 13. failed task does not silently retry
  it("13: a failed task does not silently retry", async () => {
    const adapter = new FakeClaudeAdapter({ outcome: { kind: "fail" } });
    const lockStore = new InMemoryLockStore();
    const deps = { source: [baseEnvelope()], adapter, lockStore, now: CLOCK };
    const first = await continueForever(deps);
    expect(first.report.stopCode).toBe("EXECUTION_FAILED");
    const second = await continueForever(deps);
    expect(second.report.stopCode).toBe("FAILED_REQUIRES_RETRY");
    expect(adapter.executeCount).toBe(1);
    // Explicit retry re-executes exactly once more.
    const retried = await continueForever({ ...deps, retry: true });
    expect(retried.report.stopCode).toBe("EXECUTION_FAILED");
    expect(adapter.executeCount).toBe(2);
  });

  // 14. Fable approval stop is preserved
  it("14: the Fable approval stop is preserved", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: [baseEnvelope({ packet: { routing: { architecturalImpact: "systemic" } } })],
      adapter,
      now: CLOCK,
    });
    expect(res.report.stopCode).toBe("ROUTER_BLOCKED");
    expect(res.report.connectorArtifact?.blocked?.routingStopCode).toBe(
      "stop_pending_fable_approval",
    );
    expect(adapter.executeCount).toBe(0);
  });

  // 15. max approval stop is preserved
  it("15: the max approval stop is preserved", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: [
        baseEnvelope({
          packet: { routing: { requestedEffort: { effort: "max", justification: "need max" } } },
        }),
      ],
      adapter,
      now: CLOCK,
    });
    expect(res.report.stopCode).toBe("ROUTER_BLOCKED");
    expect(res.report.connectorArtifact?.blocked?.routingStopCode).toBe(
      "stop_pending_max_approval",
    );
    expect(adapter.executeCount).toBe(0);
  });

  // 16. publishing is blocked without explicit authorization
  it("16: publishing is blocked without explicit authorization", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: [baseEnvelope({ packet: { handoff: { createPullRequest: true } } })],
      adapter,
      now: CLOCK,
    });
    expect(res.report.publishingState).toContain("OWNER_APPROVAL_REQUIRED");
    expect(res.report.ownerApprovalAction).toContain("OWNER_APPROVAL_REQUIRED");
    expect(res.report.blockers.join(" ")).toContain("no explicit Owner publishing authorization");
  });

  // 17. automatic merge remains impossible (even with publishing authorized)
  it("17: automatic merge remains impossible", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: [
        baseEnvelope({
          packet: { handoff: { createPullRequest: true } },
          publishing: {
            authorized: true,
            authorizationRecord: "OQ-APPROVAL-2026-07-14",
            actions: ["commit", "pull_request"],
          },
        }),
      ],
      adapter,
      now: CLOCK,
    });
    expect(res.report.automaticMerge).toBe(false);
    expect(res.report.connectorArtifact?.automaticMerge).toBe(false);
    expect(res.report.connectorArtifact?.handoff?.operatorTask.allowAutomaticMerge).toBe(false);
  });

  // 18. the final report contains the required fields
  it("18: the final report contains the required fields", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({ source: [baseEnvelope()], adapter, now: CLOCK });
    const r = res.report;
    expect(r.taskPacketId).toBeTruthy();
    expect(r.missionTitle).toBeTruthy();
    expect(r.finalState).toBeTruthy();
    expect(r.selectedModel).toBeTruthy();
    expect(r.selectedEffort).toBeTruthy();
    expect(r.modelSelectionReasons.length).toBeGreaterThan(0);
    expect(r.executionResult).toBeTruthy();
    expect(r.operatorHandoffStatus).toBeTruthy();
    expect(r.validationGateStatus).toBeTruthy();
    expect(r.publishingState).toBeTruthy();
    expect(r.nextTaskStarted).toBe(false);
    expect(r.automaticMerge).toBe(false);
    expect(r.artifactLocation?.branchName).toBe("factory/a1-002-connector-proving");
  });

  // 19. secrets and provider session data are redacted
  it("19: secrets and provider session data are redacted", async () => {
    const adapter = new FakeClaudeAdapter({
      outcome: {
        kind: "succeed",
        resultSummary:
          "Done. Visit https://claude.ai/session/secret-xyz using Bearer sk-ABC123SECRET.",
      },
    });
    const res = await continueForever({ source: [baseEnvelope()], adapter, now: CLOCK });
    expect(res.report.executionResult).not.toContain("sk-ABC123SECRET");
    expect(res.report.executionResult).not.toContain("claude.ai/session/secret-xyz");
  });

  // 20. full hermetic proving cycle (explicitly fake mode)
  it("20: full hermetic proving cycle ends with a handoff and no next task", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: [baseEnvelope()],
      adapter,
      executionMode: "fake",
      now: CLOCK,
    });
    // approved packet → router → fake provider → operator handoff → report → stop
    expect(res.report.executionMode).toBe("fake");
    expect(res.report.selectedModel).toBe("Claude Sonnet 5.0");
    expect(adapter.executeCount).toBe(1);
    expect(res.report.finalState).toBe("handed_off");
    expect(res.report.connectorArtifact?.handoff?.approvalState).toBe("approved");
    expect(res.report.nextTaskStarted).toBe(false);
    expect(res.report.automaticMerge).toBe(false);
  });
});

describe("Continue Forever — execution mode (live default, fake opt-in)", () => {
  it("infers fake mode from the fake adapter and marks the report HERMETIC_TEST", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({ source: [baseEnvelope()], adapter, now: CLOCK });
    expect(res.report.executionMode).toBe("fake");
    expect(res.report.executionResult).toContain("HERMETIC_TEST");
    expect(res.report.executionResult).toContain("TEST_ONLY");
  });

  it("fails closed with LIVE_EXECUTION_UNAVAILABLE and never falls back to fake", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: [baseEnvelope()],
      adapter,
      executionMode: "live",
      probeAvailability: () => ({ available: false, reason: "claude binary not found" }),
      now: CLOCK,
    });
    expect(res.report.stopCode).toBe("LIVE_EXECUTION_UNAVAILABLE");
    expect(res.report.executionMode).toBe("live");
    // No fallback to the fake adapter: it was never invoked.
    expect(adapter.executeCount).toBe(0);
  });

  it("maps a live runtime environment/auth failure to LIVE_EXECUTION_UNAVAILABLE", async () => {
    const adapter = new FakeClaudeAdapter({
      outcome: { kind: "fail", failureClass: "environment", message: "not authenticated" },
    });
    const res = await continueForever({
      source: [baseEnvelope()],
      adapter,
      executionMode: "live",
      probeAvailability: () => ({ available: true }),
      now: CLOCK,
    });
    expect(res.report.stopCode).toBe("LIVE_EXECUTION_UNAVAILABLE");
    expect(adapter.executeCount).toBe(1); // it tried live, did not simulate success
  });

  it("proceeds in live mode when the availability probe reports available", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: [baseEnvelope()],
      adapter,
      executionMode: "live",
      probeAvailability: () => ({ available: true }),
      now: CLOCK,
    });
    expect(res.report.executionMode).toBe("live");
    expect(res.report.executionResult).not.toContain("HERMETIC_TEST");
    expect(adapter.executeCount).toBe(1);
  });
});

/** A minimal store double that yields a fixed acquire outcome / health. */
function stubStore(over: Partial<LockStore> = {}): LockStore {
  return {
    acquire: () => ({ outcome: "acquired" }) as AcquireResult,
    finalize: () => {},
    release: () => {},
    health: () => ({ ok: true }),
    ...over,
  };
}

describe("Continue Forever — corrupt run state fails closed", () => {
  it("stops with CORRUPT_RUN_STATE and never invokes the adapter", async () => {
    const adapter = new FakeClaudeAdapter();
    const lockStore = stubStore({
      health: () => ({
        ok: false,
        reason: "Lock file is not valid JSON.",
        path: "/repo/.forever-factory/state/locks.json",
      }),
      acquire: () => {
        throw new Error("corrupt state must stop before acquire");
      },
    });
    const res = await continueForever({ source: [baseEnvelope()], adapter, lockStore, now: CLOCK });
    expect(res.report.stopCode).toBe("CORRUPT_RUN_STATE");
    expect(adapter.executeCount).toBe(0);
    expect(res.report.blockers.join(" ")).toContain("/repo/.forever-factory/state/locks.json");
    expect(res.report.ownerApprovalAction).toContain("Park for Owner review");
  });
});

describe("Continue Forever — stale run parks for Owner recovery", () => {
  it("maps a stale acquire to STALE_RUN_REQUIRES_OWNER_RECOVERY without executing", async () => {
    const adapter = new FakeClaudeAdapter();
    const lockStore = stubStore({
      acquire: () => ({
        outcome: "stale",
        record: {
          runId: "r",
          taskPacketId: "t",
          state: "running",
          stampedAt: CLOCK(),
          artifact: null,
          owner: { pid: 999999, host: "otherhost" },
        },
        note: "Stale running claim: owner is on another host.",
      }),
    });
    const res = await continueForever({ source: [baseEnvelope()], adapter, lockStore, now: CLOCK });
    expect(res.report.stopCode).toBe("STALE_RUN_REQUIRES_OWNER_RECOVERY");
    expect(adapter.executeCount).toBe(0);
    expect(res.report.ownerApprovalAction).toContain("--recover");
  });
});

describe("Continue Forever — strict canonical current-task state", () => {
  it("stops with CURRENT_TASK_STATE_CONFLICT on a divergent Operator task id", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: [baseEnvelope({ packet: { routing: { taskPacketId: "FACTORY-A1-003-A" } } })],
      adapter,
      operatorTaskState: { status: "valid", taskId: "FACTORY-A1-003-B" },
      now: CLOCK,
    });
    expect(res.report.stopCode).toBe("CURRENT_TASK_STATE_CONFLICT");
    expect(adapter.executeCount).toBe(0);
  });

  it("stops with CURRENT_TASK_STATE_INVALID for an invalid Operator task (no silent skip)", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: [baseEnvelope()],
      adapter,
      operatorTaskState: { status: "invalid", reason: "CURRENT_TASK.json is not valid JSON." },
      now: CLOCK,
    });
    expect(res.report.stopCode).toBe("CURRENT_TASK_STATE_INVALID");
    expect(adapter.executeCount).toBe(0);
  });

  it("runs deterministically when the Operator task id matches", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: [baseEnvelope({ packet: { routing: { taskPacketId: "FACTORY-A1-003-A" } } })],
      adapter,
      operatorTaskState: { status: "valid", taskId: "FACTORY-A1-003-A" },
      now: CLOCK,
    });
    expect(res.report.stopCode).toBeNull();
    expect(res.report.finalState).toBe("handed_off");
  });

  it("treats an absent Operator task as no conflict", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: [baseEnvelope()],
      adapter,
      operatorTaskState: { status: "absent" },
      now: CLOCK,
    });
    expect(res.report.finalState).toBe("handed_off");
  });

  it("maps a source read error to a structured CURRENT_TASK_INVALID (not an exception)", async () => {
    const adapter = new FakeClaudeAdapter();
    const res = await continueForever({
      source: () => {
        throw new SourceReadError("Continue source is not valid JSON.");
      },
      adapter,
      now: CLOCK,
    });
    expect(res.report.stopCode).toBe("CURRENT_TASK_INVALID");
    expect(adapter.executeCount).toBe(0);
  });
});

describe("Continue Forever — auth failure maps to LIVE_EXECUTION_UNAVAILABLE", () => {
  it("recognizes a login/auth failure message in live mode", async () => {
    const adapter = new FakeClaudeAdapter({
      outcome: {
        kind: "fail",
        failureClass: "provider",
        message: "Claude Code reported a non-success result: Invalid API key · Please run /login",
      },
    });
    const res = await continueForever({
      source: [baseEnvelope()],
      adapter,
      executionMode: "live",
      probeAvailability: () => ({ available: true }),
      now: CLOCK,
    });
    expect(res.report.stopCode).toBe("LIVE_EXECUTION_UNAVAILABLE");
    expect(adapter.executeCount).toBe(1);
  });
});
