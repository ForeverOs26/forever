import { describe, expect, it } from "vitest";

import {
  PIPELINE_ERROR_STRATEGIES,
  PIPELINE_EXECUTION_MODES,
  PIPELINE_MODES,
  PIPELINE_STAGE_KINDS,
  PIPELINE_STATES,
  PIPELINE_STEP_KINDS,
  PIPELINE_TERMINAL_STATES,
  comparePipelineVersion,
  defaultPipelinePolicy,
  derivePipelineOutcome,
  derivePipelineState,
  emptyPipelineStats,
  formatPipelineVersion,
  isKnownPipelineErrorStrategy,
  isKnownPipelineExecutionMode,
  isKnownPipelineMode,
  isKnownPipelineStageKind,
  isKnownPipelineState,
  isKnownPipelineStepKind,
  isSuccessfulPipelineOutcome,
  isTerminalPipelineState,
  pipelineStage,
  pipelineStep,
  pipelineVersion,
  type PipelineStats,
} from "..";

describe("mode model", () => {
  it("guards known modes", () => {
    expect(PIPELINE_MODES.every(isKnownPipelineMode)).toBe(true);
    expect(isKnownPipelineMode("teleport")).toBe(false);
  });
});

describe("step model", () => {
  it("builds a minimal step and attaches references only when supplied", () => {
    expect(pipelineStep("s1", "Step 1", "import")).toEqual({
      id: "s1",
      name: "Step 1",
      kind: "import",
    });
    expect(
      pipelineStep("s2", "Step 2", "sync", {
        entityKind: "project",
        direction: "push",
        connectorId: "conn_x",
        dependsOn: ["s1"],
        optional: true,
      }),
    ).toEqual({
      id: "s2",
      name: "Step 2",
      kind: "sync",
      entityKind: "project",
      direction: "push",
      connectorId: "conn_x",
      dependsOn: ["s1"],
      optional: true,
    });
  });

  it("guards known step kinds", () => {
    expect(PIPELINE_STEP_KINDS.every(isKnownPipelineStepKind)).toBe(true);
    expect(isKnownPipelineStepKind("teleport")).toBe(false);
  });
});

describe("stage model", () => {
  it("builds a stage and attaches continueOnError only when supplied", () => {
    const steps = [pipelineStep("s1", "Step 1", "import")];
    expect(pipelineStage("st1", "Stage 1", "ingest", steps)).toEqual({
      id: "st1",
      name: "Stage 1",
      kind: "ingest",
      steps,
    });
    expect(pipelineStage("st1", "Stage 1", "ingest", steps, { continueOnError: true })).toEqual({
      id: "st1",
      name: "Stage 1",
      kind: "ingest",
      steps,
      continueOnError: true,
    });
  });

  it("guards known stage kinds", () => {
    expect(PIPELINE_STAGE_KINDS.every(isKnownPipelineStageKind)).toBe(true);
    expect(isKnownPipelineStageKind("finalize")).toBe(false);
  });
});

describe("policy model", () => {
  it("defaults to a conservative, dry-run-only, sequential posture", () => {
    expect(defaultPipelinePolicy()).toEqual({
      id: "default",
      executionMode: "sequential",
      onError: "abort",
      retry: { maxAttempts: 1, backoff: "none" },
      dryRunOnly: true,
    });
  });

  it("applies overrides without mutating the default", () => {
    const policy = defaultPipelinePolicy({ executionMode: "parallel", dryRunOnly: false });
    expect(policy.executionMode).toBe("parallel");
    expect(policy.dryRunOnly).toBe(false);
    expect(defaultPipelinePolicy().executionMode).toBe("sequential");
  });

  it("guards known execution modes and error strategies", () => {
    expect(PIPELINE_EXECUTION_MODES.every(isKnownPipelineExecutionMode)).toBe(true);
    expect(isKnownPipelineExecutionMode("burst")).toBe(false);
    expect(PIPELINE_ERROR_STRATEGIES.every(isKnownPipelineErrorStrategy)).toBe(true);
    expect(isKnownPipelineErrorStrategy("ignore")).toBe(false);
  });
});

describe("version model", () => {
  it("formats and compares deterministically, ignoring the label in ordering", () => {
    expect(formatPipelineVersion(pipelineVersion(1, 2, 3))).toBe("1.2.3");
    expect(formatPipelineVersion(pipelineVersion(1, 2, 3, "draft"))).toBe("1.2.3-draft");
    expect(Math.sign(comparePipelineVersion(pipelineVersion(1, 0, 0), pipelineVersion(1, 1, 0)))).toBe(
      -1,
    );
    expect(
      comparePipelineVersion(pipelineVersion(1, 0, 0, "a"), pipelineVersion(1, 0, 0, "b")),
    ).toBe(0);
  });
});

describe("state model", () => {
  it("classifies terminal states and guards known states", () => {
    expect(PIPELINE_TERMINAL_STATES.every(isTerminalPipelineState)).toBe(true);
    expect(isTerminalPipelineState("running")).toBe(false);
    expect(isTerminalPipelineState("pending")).toBe(false);
    expect(PIPELINE_STATES.every(isKnownPipelineState)).toBe(true);
    expect(isKnownPipelineState("paused")).toBe(false);
  });

  it("classifies successful outcomes", () => {
    expect(isSuccessfulPipelineOutcome("success")).toBe(true);
    expect(isSuccessfulPipelineOutcome("noop")).toBe(true);
    expect(isSuccessfulPipelineOutcome("partial")).toBe(false);
    expect(isSuccessfulPipelineOutcome("failure")).toBe(false);
  });
});

describe("state/outcome derivation", () => {
  const base = emptyPipelineStats();

  it("maps counters to outcome and state deterministically", () => {
    const success: PipelineStats = { ...base, steps: 2, completed: 2 };
    const partial: PipelineStats = { ...base, steps: 2, completed: 1, failed: 1 };
    const failure: PipelineStats = { ...base, steps: 1, failed: 1 };
    const noop: PipelineStats = { ...base };

    expect(derivePipelineOutcome(success)).toBe("success");
    expect(derivePipelineState(success)).toBe("succeeded");
    expect(derivePipelineOutcome(partial)).toBe("partial");
    expect(derivePipelineState(partial)).toBe("partial");
    expect(derivePipelineOutcome(failure)).toBe("failure");
    expect(derivePipelineState(failure)).toBe("failed");
    expect(derivePipelineOutcome(noop)).toBe("noop");
    expect(derivePipelineState(noop)).toBe("skipped");
  });

  it("treats an error count as a failure even without a failed step", () => {
    const errored: PipelineStats = { ...base, steps: 1, completed: 0, errors: 1 };
    expect(derivePipelineOutcome(errored)).toBe("failure");
  });
});
