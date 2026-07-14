import { describe, expect, it } from "vitest";

import type { ExecutionConnectorPacket } from "./contracts";
import { deriveRunId, InMemoryRunStore } from "./run-store";
import { basePacket } from "./test-fixtures";

function packet(overrides: (p: ExecutionConnectorPacket) => ExecutionConnectorPacket) {
  return overrides(basePacket());
}

describe("run identity", () => {
  it("is deterministic for identical packets", () => {
    expect(deriveRunId(basePacket())).toBe(deriveRunId(basePacket()));
  });

  it("starts with the task packet id", () => {
    expect(deriveRunId(basePacket())).toMatch(/^FACTORY-A1-002-TEST-[0-9a-f]{8}$/);
  });

  it("changes when execution content changes", () => {
    const a = deriveRunId(basePacket());
    const b = deriveRunId(
      packet((p) => ({ ...p, execution: { ...p.execution, prompt: "different prompt" } })),
    );
    expect(a).not.toBe(b);
  });

  it("is stable regardless of allowed-scope ordering", () => {
    const a = deriveRunId(
      packet((p) => ({ ...p, execution: { ...p.execution, allowedScope: ["docs/**", "src/**"] } })),
    );
    const b = deriveRunId(
      packet((p) => ({ ...p, execution: { ...p.execution, allowedScope: ["src/**", "docs/**"] } })),
    );
    expect(a).toBe(b);
  });

  it("treats a re-route after a failure as a new run", () => {
    const a = deriveRunId(basePacket());
    const b = deriveRunId(
      packet((p) => ({
        ...p,
        routing: {
          ...p.routing,
          priorModelAttempts: [
            { tier: "drafting", failureClass: "gate", diagnosis: "one gate failure" },
          ],
        },
      })),
    );
    expect(a).not.toBe(b);
  });
});

describe("in-memory run store", () => {
  it("stores and returns the latest record", () => {
    const store = new InMemoryRunStore();
    store.put({ runId: "r1", taskPacketId: "T", state: "running", artifact: null });
    expect(store.get("r1")?.state).toBe("running");
    store.put({ runId: "r1", taskPacketId: "T", state: "succeeded", artifact: null });
    expect(store.get("r1")?.state).toBe("succeeded");
  });
});
