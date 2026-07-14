import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { validateOperatorTask } from "../operator-handoff";
import { resolveProviderModel, type ConnectorArtifact } from "./contracts";
import { runExecutionConnector, type ConnectorRuntime } from "./connector";
import { FakeClaudeAdapter } from "./adapters/fake-adapter";
import { InMemoryRunStore } from "./run-store";
import { basePacket, BASE_COMMIT } from "./test-fixtures";

const FIXED_NOW = "2026-07-14T00:00:00.000Z";

function runtime(store = new InMemoryRunStore()): ConnectorRuntime {
  return { store, now: () => FIXED_NOW };
}

async function run(
  packetOverrides: Parameters<typeof basePacket>[0] = {},
  adapter = new FakeClaudeAdapter(),
  store = new InMemoryRunStore(),
): Promise<{ artifact: ConnectorArtifact; adapter: FakeClaudeAdapter }> {
  const artifact = await runExecutionConnector(basePacket(packetOverrides), adapter, {
    runtime: runtime(store),
  });
  return { artifact, adapter };
}

describe("execution connector", () => {
  // 1 + 2. Approved packet → router → execution request; Sonnet reaches adapter unchanged.
  it("routes an approved R0 packet and passes Sonnet + effort to the adapter unchanged", async () => {
    const { artifact, adapter } = await run();
    expect(adapter.executeCount).toBe(1);
    const request = adapter.requests[0];
    expect(request.model).toBe("Claude Sonnet 5.0");
    expect(request.providerModel).toBe("claude-sonnet-5");
    expect(request.tier).toBe("drafting");
    expect(request.effort).toBe("medium");
    expect(request.taskPacketId).toBe("FACTORY-A1-002-TEST");
    expect(request.stopCondition).toContain("Stop after");
    expect(artifact.capture.selectedModel).toBe("Claude Sonnet 5.0");
  });

  // 3. Opus reaches the adapter unchanged.
  it("passes Opus + effort to the adapter unchanged for R1 work", async () => {
    const { artifact, adapter } = await run({ routing: { riskClass: "R1" } });
    const request = adapter.requests[0];
    expect(request.model).toBe("Claude Opus 4.8");
    expect(request.providerModel).toBe("claude-opus-4-8");
    expect(request.tier).toBe("engineering");
    expect(request.effort).toBe("medium");
    expect(artifact.state).toBe("handed_off");
  });

  // 4. Fable stop state prevents execution.
  it("prevents execution on a Fable stop state", async () => {
    const { artifact, adapter } = await run({ routing: { riskClass: "R3" } });
    expect(adapter.executeCount).toBe(0);
    expect(artifact.state).toBe("blocked");
    expect(artifact.blocked?.code).toBe("routing_stopped");
    expect(artifact.blocked?.routingStopCode).toBe("stop_pending_fable_approval");
    expect(artifact.handoff).toBeNull();
  });

  // 5. max stop state prevents execution.
  it("prevents execution on a max-effort stop state", async () => {
    const { artifact, adapter } = await run({
      routing: { requestedEffort: { effort: "max", justification: "Critical." } },
    });
    expect(adapter.executeCount).toBe(0);
    expect(artifact.state).toBe("blocked");
    expect(artifact.blocked?.routingStopCode).toBe("stop_pending_max_approval");
  });

  // 6. Unsupported model mapping fails closed.
  it("fails closed on an unmapped router model string", () => {
    expect(resolveProviderModel("Some Unknown Model")).toMatchObject({ ok: false });
  });

  it("fails closed when the adapter does not support the routed model", async () => {
    const restricted = new FakeClaudeAdapter({
      capability: {
        name: "sonnet-only",
        supportedModels: ["claude-sonnet-5"],
        supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
      },
    });
    const { artifact } = await run({ routing: { riskClass: "R1" } }, restricted);
    expect(restricted.executeCount).toBe(0);
    expect(artifact.state).toBe("blocked");
    expect(artifact.blocked?.code).toBe("unsupported_model");
  });

  // 7. Unsupported effort mapping fails closed.
  it("fails closed when the adapter cannot apply the routed effort", async () => {
    const restricted = new FakeClaudeAdapter({
      capability: {
        name: "low-effort-only",
        supportedModels: ["claude-sonnet-5", "claude-opus-4-8", "claude-fable-5"],
        supportedEfforts: ["low"],
      },
    });
    const { artifact } = await run({}, restricted); // R0 default effort is "medium"
    expect(restricted.executeCount).toBe(0);
    expect(artifact.state).toBe("blocked");
    expect(artifact.blocked?.code).toBe("unsupported_effort");
  });

  // 8. Unapproved packet cannot execute.
  it("refuses to execute an unapproved packet", async () => {
    const { artifact, adapter } = await run({ routing: { approvalState: "proposed" } });
    expect(adapter.executeCount).toBe(0);
    expect(artifact.state).toBe("blocked");
    expect(artifact.blocked?.code).toBe("packet_invalid");
  });

  // 9. Duplicate Task Packet cannot execute twice.
  it("does not execute the same approved packet twice", async () => {
    const store = new InMemoryRunStore();
    const adapter = new FakeClaudeAdapter();
    const first = await runExecutionConnector(basePacket(), adapter, { runtime: runtime(store) });
    const second = await runExecutionConnector(basePacket(), adapter, { runtime: runtime(store) });
    expect(adapter.executeCount).toBe(1);
    expect(second.runId).toBe(first.runId);
    expect(second).toEqual(first);
  });

  // 10. Provider failure becomes a structured failed result.
  it("captures a provider failure as a structured failed result", async () => {
    const adapter = new FakeClaudeAdapter({
      outcome: { kind: "fail", message: "provider crashed" },
    });
    const { artifact } = await run({ routing: { riskClass: "R1" } }, adapter);
    expect(artifact.state).toBe("failed");
    expect(artifact.handoff).toBeNull();
    expect(artifact.capture.failure?.failureClass).toBe("provider");
    expect(artifact.capture.escalationHistory).toHaveLength(1);
    expect(artifact.capture.escalationHistory[0].failureClass).toBe("capability");
  });

  // 11. Timeout becomes a structured failed result.
  it("captures a timeout as a structured failed result", async () => {
    const adapter = new FakeClaudeAdapter({ outcome: { kind: "timeout" } });
    const { artifact } = await run({}, adapter);
    expect(artifact.state).toBe("failed");
    expect(artifact.capture.exitStatus).toBe("timeout");
    expect(artifact.capture.failure?.failureClass).toBe("timeout");
    expect(artifact.capture.escalationHistory[0].failureClass).toBe("environment");
  });

  // 12 + 15. Successful result becomes a valid Operator-compatible handoff (full proving cycle).
  it("proves approved packet → route → fake execution → captured result → Operator handoff", async () => {
    const { artifact } = await run({ routing: { riskClass: "R1", title: "Proving packet" } });
    expect(artifact.state).toBe("handed_off");
    expect(artifact.capture.startedAt).toBe(FIXED_NOW);
    expect(artifact.capture.finishedAt).toBe(FIXED_NOW);
    expect(artifact.capture.patchPath).toMatch(/^inbox\/FACTORY-A1-002-TEST-[0-9a-f]{8}\.patch$/);

    const handoff = artifact.handoff;
    expect(handoff).not.toBeNull();
    if (!handoff) return;
    expect(handoff.selectedModel).toBe("Claude Opus 4.8");
    expect(handoff.selectedEffort).toBe("medium");
    expect(handoff.operatorTask.expectedBaseCommit).toBe(BASE_COMMIT);
    expect(validateOperatorTask(handoff.operatorTask)).toEqual([]);

    const schema = JSON.parse(
      readFileSync(join(process.cwd(), ".forever-factory", "task.schema.json"), "utf-8"),
    ) as { required: string[]; properties: Record<string, unknown> };
    for (const key of schema.required) {
      expect(handoff.operatorTask).toHaveProperty(key);
    }
  });

  // 13. Automatic merge remains impossible.
  it("keeps automatic merge impossible", async () => {
    const { artifact } = await run({ routing: { riskClass: "R1" } });
    expect(artifact.automaticMerge).toBe(false);
    expect(artifact.handoff?.operatorTask.allowAutomaticMerge).toBe(false);
  });

  // 14. Secrets are redacted from logs and artifacts.
  it("redacts secrets from the captured artifact", async () => {
    const adapter = new FakeClaudeAdapter({
      outcome: {
        kind: "succeed",
        resultSummary:
          "Done. See https://example.com/s/FAKESESSIONMARKER token sk-ant-EXAMPLENOTAREALKEY01 done.",
        patchPath: "inbox/redaction.patch",
      },
    });
    const { artifact } = await run({ routing: { riskClass: "R1" } }, adapter);
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain("example.com");
    expect(serialized).not.toContain("sk-ant-EXAMPLENOTAREALKEY01");
    expect(serialized).not.toContain("FAKESESSIONMARKER");
    expect(serialized).toContain("[REDACTED]");
  });

  it("fails closed on a duplicate in-flight run", async () => {
    const store = new InMemoryRunStore();
    const packet = basePacket();
    const runId = (await import("./run-store")).deriveRunId(packet);
    store.put({
      runId,
      taskPacketId: packet.routing.taskPacketId,
      state: "running",
      artifact: null,
    });
    const artifact = await runExecutionConnector(packet, new FakeClaudeAdapter(), {
      runtime: runtime(store),
    });
    expect(artifact.state).toBe("blocked");
    expect(artifact.blocked?.code).toBe("duplicate_execution_in_flight");
  });
});
