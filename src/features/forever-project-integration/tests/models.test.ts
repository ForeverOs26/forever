import { describe, expect, it } from "vitest";

import {
  PROJECT_INTEGRATION_SCOPES,
  PROJECT_INTEGRATION_STAGE_KINDS,
  PROJECT_INTEGRATION_STATES,
  PROJECT_INTEGRATION_STEP_KINDS,
  PROJECT_INTEGRATION_TERMINAL_STATES,
  compareProjectIntegrationVersion,
  defaultProjectIntegrationPolicy,
  deriveProjectIntegrationOutcome,
  deriveProjectIntegrationState,
  emptyProjectIntegrationStats,
  formatProjectIntegrationVersion,
  isKnownProjectIntegrationScope,
  isKnownProjectIntegrationStageKind,
  isKnownProjectIntegrationState,
  isKnownProjectIntegrationStepKind,
  isSuccessfulProjectIntegrationOutcome,
  isTerminalProjectIntegrationState,
  projectIntegrationStage,
  projectIntegrationStep,
  projectIntegrationVersion,
  type ProjectIntegrationStats,
} from "..";

describe("scope model", () => {
  it("guards known scopes", () => {
    expect(PROJECT_INTEGRATION_SCOPES.every(isKnownProjectIntegrationScope)).toBe(true);
    expect(isKnownProjectIntegrationScope("galaxy")).toBe(false);
    expect(isKnownProjectIntegrationScope(42)).toBe(false);
  });
});

describe("step model", () => {
  it("builds a minimal step and attaches references only when supplied", () => {
    expect(projectIntegrationStep("s1", "Step 1", "source")).toEqual({
      id: "s1",
      name: "Step 1",
      kind: "source",
    });
    expect(
      projectIntegrationStep("s2", "Step 2", "sync", {
        entityKind: "project",
        sourceId: "src_x",
        connectorId: "conn_x",
        pipelineId: "pipe_x",
        system: "forever_database",
        direction: "push",
        dependsOn: ["s1"],
        optional: true,
      }),
    ).toEqual({
      id: "s2",
      name: "Step 2",
      kind: "sync",
      entityKind: "project",
      sourceId: "src_x",
      connectorId: "conn_x",
      pipelineId: "pipe_x",
      system: "forever_database",
      direction: "push",
      dependsOn: ["s1"],
      optional: true,
    });
  });

  it("guards known step kinds", () => {
    expect(PROJECT_INTEGRATION_STEP_KINDS.every(isKnownProjectIntegrationStepKind)).toBe(true);
    expect(isKnownProjectIntegrationStepKind("teleport")).toBe(false);
  });
});

describe("stage model", () => {
  it("builds a stage and attaches continueOnError only when supplied", () => {
    const steps = [projectIntegrationStep("s1", "Step 1", "source")];
    expect(projectIntegrationStage("st1", "Stage 1", "acquire", steps)).toEqual({
      id: "st1",
      name: "Stage 1",
      kind: "acquire",
      steps,
    });
    expect(
      projectIntegrationStage("st1", "Stage 1", "acquire", steps, { continueOnError: true }),
    ).toEqual({
      id: "st1",
      name: "Stage 1",
      kind: "acquire",
      steps,
      continueOnError: true,
    });
  });

  it("guards known stage kinds", () => {
    expect(PROJECT_INTEGRATION_STAGE_KINDS.every(isKnownProjectIntegrationStageKind)).toBe(true);
    expect(isKnownProjectIntegrationStageKind("finalize")).toBe(false);
  });
});

describe("policy model", () => {
  it("defaults to a conservative, dry-run-only, sequential posture", () => {
    expect(defaultProjectIntegrationPolicy()).toEqual({
      id: "default",
      executionMode: "sequential",
      onError: "abort",
      retry: { maxAttempts: 1, backoff: "none" },
      dryRunOnly: true,
    });
  });

  it("applies overrides without mutating the default", () => {
    const policy = defaultProjectIntegrationPolicy({ executionMode: "parallel", dryRunOnly: false });
    expect(policy.executionMode).toBe("parallel");
    expect(policy.dryRunOnly).toBe(false);
    expect(defaultProjectIntegrationPolicy().executionMode).toBe("sequential");
  });
});

describe("version model", () => {
  it("formats and compares deterministically, ignoring the label in ordering", () => {
    expect(formatProjectIntegrationVersion(projectIntegrationVersion(1, 2, 3))).toBe("1.2.3");
    expect(formatProjectIntegrationVersion(projectIntegrationVersion(1, 2, 3, "draft"))).toBe(
      "1.2.3-draft",
    );
    expect(
      Math.sign(
        compareProjectIntegrationVersion(
          projectIntegrationVersion(1, 0, 0),
          projectIntegrationVersion(1, 1, 0),
        ),
      ),
    ).toBe(-1);
    expect(
      compareProjectIntegrationVersion(
        projectIntegrationVersion(1, 0, 0, "a"),
        projectIntegrationVersion(1, 0, 0, "b"),
      ),
    ).toBe(0);
  });
});

describe("state model", () => {
  it("classifies terminal states and guards known states", () => {
    expect(PROJECT_INTEGRATION_TERMINAL_STATES.every(isTerminalProjectIntegrationState)).toBe(true);
    expect(isTerminalProjectIntegrationState("running")).toBe(false);
    expect(isTerminalProjectIntegrationState("pending")).toBe(false);
    expect(PROJECT_INTEGRATION_STATES.every(isKnownProjectIntegrationState)).toBe(true);
    expect(isKnownProjectIntegrationState("paused")).toBe(false);
  });

  it("classifies successful outcomes", () => {
    expect(isSuccessfulProjectIntegrationOutcome("success")).toBe(true);
    expect(isSuccessfulProjectIntegrationOutcome("noop")).toBe(true);
    expect(isSuccessfulProjectIntegrationOutcome("partial")).toBe(false);
    expect(isSuccessfulProjectIntegrationOutcome("failure")).toBe(false);
  });
});

describe("state/outcome derivation", () => {
  const base = emptyProjectIntegrationStats();

  it("maps counters to outcome and state deterministically", () => {
    const success: ProjectIntegrationStats = { ...base, steps: 2, completed: 2 };
    const partial: ProjectIntegrationStats = { ...base, steps: 2, completed: 1, failed: 1 };
    const failure: ProjectIntegrationStats = { ...base, steps: 1, failed: 1 };
    const noop: ProjectIntegrationStats = { ...base };

    expect(deriveProjectIntegrationOutcome(success)).toBe("success");
    expect(deriveProjectIntegrationState(success)).toBe("succeeded");
    expect(deriveProjectIntegrationOutcome(partial)).toBe("partial");
    expect(deriveProjectIntegrationState(partial)).toBe("partial");
    expect(deriveProjectIntegrationOutcome(failure)).toBe("failure");
    expect(deriveProjectIntegrationState(failure)).toBe("failed");
    expect(deriveProjectIntegrationOutcome(noop)).toBe("noop");
    expect(deriveProjectIntegrationState(noop)).toBe("skipped");
  });

  it("treats an error count as a failure even without a failed step", () => {
    const errored: ProjectIntegrationStats = { ...base, steps: 1, completed: 0, errors: 1 };
    expect(deriveProjectIntegrationOutcome(errored)).toBe("failure");
  });
});
