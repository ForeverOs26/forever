import { describe, expect, it, vi } from "vitest";

import type { ExecutionRequest } from "../contracts";
import {
  buildClaudeArgs,
  buildGuardrailPrompt,
  ClaudeCodeAdapter,
  type ProcessRunResult,
  type ProcessRunner,
} from "./claude-code-adapter";

function request(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    taskPacketId: "FACTORY-A1-002-TEST",
    runId: "FACTORY-A1-002-TEST-abcdef01",
    model: "Claude Opus 4.8",
    providerModel: "claude-opus-4-8",
    tier: "engineering",
    effort: "high",
    prompt: "Do the bounded task.",
    workingDirectory: "/repo",
    allowedScope: ["docs/**"],
    forbiddenActions: ["merge", "push"],
    timeoutMs: 60000,
    expectedResultFormat: "patch",
    stopCondition: "Stop after the patch.",
    ...overrides,
  };
}

function runnerReturning(result: Partial<ProcessRunResult>): ProcessRunner {
  return vi.fn(() =>
    Promise.resolve({ exitCode: 0, timedOut: false, stdout: "", stderr: "", ...result }),
  );
}

// A synthetic session id (never a real one) that the adapter must not surface.
const FAKE_SESSION_ID = "00000000-1111-4222-8333-444455556666";
const SUCCESS_ENVELOPE = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "Completed the bounded documentation task.",
  session_id: FAKE_SESSION_ID,
});

describe("claude code adapter command builder", () => {
  it("passes the exact provider model and effort through unchanged", () => {
    const argv = buildClaudeArgs(request({ providerModel: "claude-sonnet-5", effort: "low" }));
    const modelIdx = argv.indexOf("--model");
    const effortIdx = argv.indexOf("--effort");
    expect(argv[modelIdx + 1]).toBe("claude-sonnet-5");
    expect(argv[effortIdx + 1]).toBe("low");
  });

  it("requests structured JSON output and disables session persistence", () => {
    const argv = buildClaudeArgs(request());
    expect(argv).toContain("--print");
    expect(argv.join(" ")).toContain("--output-format json");
    expect(argv).toContain("--no-session-persistence");
  });

  it("never configures a fallback model (no silent substitution)", () => {
    expect(buildClaudeArgs(request())).not.toContain("--fallback-model");
  });

  it("runs report work read-only in plan mode and patch work in acceptEdits", () => {
    const report = buildClaudeArgs(request({ expectedResultFormat: "report" }));
    const patch = buildClaudeArgs(request({ expectedResultFormat: "patch" }));
    expect(report[report.indexOf("--permission-mode") + 1]).toBe("plan");
    expect(report[report.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
    expect(patch[patch.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    expect(patch[patch.indexOf("--tools") + 1]).toContain("Edit");
  });

  it("embeds scope and stop condition in the guardrail system prompt", () => {
    const guardrail = buildGuardrailPrompt(request());
    expect(guardrail).toContain("docs/**");
    expect(guardrail).toContain("Stop after the patch.");
    expect(guardrail).toContain("Do not merge, push");
  });
});

describe("claude code adapter execution", () => {
  it("maps a success envelope to a succeeded result without leaking the session id", async () => {
    const run = runnerReturning({ stdout: SUCCESS_ENVELOPE });
    const adapter = new ClaudeCodeAdapter({ run });
    const result = await adapter.execute(request());
    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.providerExecutionId).toBe("claude-code-FACTORY-A1-002-TEST-abcdef01");
      expect(result.patchPath).toBe("inbox/FACTORY-A1-002-TEST-abcdef01.patch");
      expect(JSON.stringify(result)).not.toContain(FAKE_SESSION_ID);
    }
  });

  it("maps a non-zero exit to a structured provider failure", async () => {
    const run = runnerReturning({ exitCode: 1, stdout: "", stderr: "boom" });
    const adapter = new ClaudeCodeAdapter({ run });
    const result = await adapter.execute(request());
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.failureClass).toBe("provider");
  });

  it("maps a timeout to a structured timeout failure", async () => {
    const run = runnerReturning({ exitCode: null, timedOut: true });
    const adapter = new ClaudeCodeAdapter({ run });
    const result = await adapter.execute(request());
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.failureClass).toBe("timeout");
      expect(result.exitStatus).toBe("timeout");
    }
  });

  it("maps an error envelope to a provider failure", async () => {
    const run = runnerReturning({
      exitCode: 0,
      stdout: JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true }),
    });
    const adapter = new ClaudeCodeAdapter({ run });
    const result = await adapter.execute(request());
    expect(result.status).toBe("failed");
  });

  it("passes the working directory and timeout to the runner", async () => {
    const run = runnerReturning({ stdout: SUCCESS_ENVELOPE });
    const adapter = new ClaudeCodeAdapter({ run });
    await adapter.execute(request({ workingDirectory: "/work", timeoutMs: 1234 }));
    expect(run).toHaveBeenCalledWith(expect.any(Array), { cwd: "/work", timeoutMs: 1234 });
  });
});
