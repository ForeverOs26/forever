import { describe, expect, it } from "vitest";
import {
  evaluateOperatorTaskObject,
  reconcileOperatorState,
  resolveCurrentTask,
} from "./current-task-resolver";
import { baseEnvelope } from "./test-fixtures";

describe("resolveCurrentTask (fail closed)", () => {
  it("stops with NO_CURRENT_TASK when nothing is marked current", () => {
    const res = resolveCurrentTask([baseEnvelope({ isCurrent: false })]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NO_CURRENT_TASK");
  });

  it("stops with NO_CURRENT_TASK on an empty source", () => {
    const res = resolveCurrentTask([]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NO_CURRENT_TASK");
  });

  it("stops with MULTIPLE_CURRENT_TASKS when more than one is current", () => {
    const res = resolveCurrentTask([
      baseEnvelope({ packet: { routing: { taskPacketId: "FACTORY-A" } } }),
      baseEnvelope({ packet: { routing: { taskPacketId: "FACTORY-B" } } }),
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("MULTIPLE_CURRENT_TASKS");
  });

  it("stops with CURRENT_TASK_NOT_APPROVED for a proposed packet", () => {
    const res = resolveCurrentTask([
      baseEnvelope({ packet: { routing: { approvalState: "proposed" } } }),
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CURRENT_TASK_NOT_APPROVED");
  });

  it("stops with CURRENT_TASK_ALREADY_COMPLETED for a completed packet", () => {
    const res = resolveCurrentTask([
      baseEnvelope({ packet: { routing: { approvalState: "completed" } } }),
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CURRENT_TASK_ALREADY_COMPLETED");
  });

  it("stops with CURRENT_TASK_ALREADY_RUNNING for an in-progress packet", () => {
    const res = resolveCurrentTask([
      baseEnvelope({ packet: { routing: { approvalState: "in-progress" } } }),
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CURRENT_TASK_ALREADY_RUNNING");
  });

  it("stops with CURRENT_TASK_SUPERSEDED when superseded", () => {
    const res = resolveCurrentTask([baseEnvelope({ supersededBy: "FACTORY-A1-099" })]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CURRENT_TASK_SUPERSEDED");
  });

  it("stops with CURRENT_TASK_INVALID for a missing stop condition", () => {
    const res = resolveCurrentTask([
      baseEnvelope({ packet: { execution: { stopCondition: "" } } }),
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CURRENT_TASK_INVALID");
  });

  it("stops with CURRENT_TASK_INVALID for an empty allowed scope", () => {
    const res = resolveCurrentTask([baseEnvelope({ packet: { execution: { allowedScope: [] } } })]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CURRENT_TASK_INVALID");
  });

  it("stops with CURRENT_TASK_INVALID for an invalid base commit", () => {
    const res = resolveCurrentTask([
      baseEnvelope({ packet: { execution: { expectedBaseCommit: "not-a-sha" } } }),
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CURRENT_TASK_INVALID");
  });

  it("resolves the single approved current packet", () => {
    const res = resolveCurrentTask([
      baseEnvelope({ isCurrent: false }),
      baseEnvelope({ packet: { routing: { taskPacketId: "FACTORY-A1-003-TEST" } } }),
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.envelope.packet.routing.taskPacketId).toBe("FACTORY-A1-003-TEST");
  });
});

describe("evaluateOperatorTaskObject (strict Operator task validation)", () => {
  it("accepts a valid Operator task", () => {
    expect(evaluateOperatorTaskObject({ taskId: "FACTORY-A", schemaVersion: "0.1" })).toEqual({
      status: "valid",
      taskId: "FACTORY-A",
    });
  });

  it("rejects a non-object", () => {
    expect(evaluateOperatorTaskObject([]).status).toBe("invalid");
    expect(evaluateOperatorTaskObject("x").status).toBe("invalid");
  });

  it("rejects a missing/invalid taskId", () => {
    expect(evaluateOperatorTaskObject({}).status).toBe("invalid");
    expect(evaluateOperatorTaskObject({ taskId: 5 }).status).toBe("invalid");
  });

  it("rejects an unsupported schemaVersion", () => {
    expect(evaluateOperatorTaskObject({ taskId: "FACTORY-A", schemaVersion: "9" }).status).toBe(
      "invalid",
    );
  });
});

describe("reconcileOperatorState (one authoritative Task Packet id)", () => {
  it("is ok when the Operator task is absent", () => {
    expect(reconcileOperatorState("FACTORY-A", { status: "absent" }).ok).toBe(true);
  });

  it("is ok when the Operator task id matches", () => {
    expect(reconcileOperatorState("FACTORY-A", { status: "valid", taskId: "FACTORY-A" }).ok).toBe(
      true,
    );
  });

  it("conflicts when the Operator task id differs", () => {
    const res = reconcileOperatorState("FACTORY-A", { status: "valid", taskId: "FACTORY-B" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CURRENT_TASK_STATE_CONFLICT");
  });

  it("fails closed (never skips) for an invalid Operator task", () => {
    const res = reconcileOperatorState("FACTORY-A", { status: "invalid", reason: "bad json" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CURRENT_TASK_STATE_INVALID");
  });
});
