import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { routeTaskPacket, type TaskPacketRoutingMetadata } from "./model-router";
import {
  buildOperatorHandoff,
  validateOperatorTask,
  type ExecutionResult,
  type HandoffPacketControls,
  type OperatorTask,
} from "./operator-handoff";

const BASE_COMMIT = "8afc507cbd1beb2ab4a90ce4a496d1f606e6ea6a";

function metadata(overrides: Partial<TaskPacketRoutingMetadata> = {}): TaskPacketRoutingMetadata {
  return {
    schemaVersion: "0.1",
    taskPacketId: "FACTORY-A1-TEST",
    title: "Handoff test packet",
    approvalState: "approved",
    riskClass: "R0",
    ambiguity: "low",
    evidenceSensitivity: "low",
    gateBlindness: "low",
    taskScope: "Bounded documentation alignment.",
    taskComplexity: "ordinary",
    affectedSubsystems: ["docs"],
    estimatedDuration: "bounded",
    architecturalImpact: "none",
    canonicalDataImpact: false,
    priorModelAttempts: [],
    ...overrides,
  };
}

function execution(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    status: "completed",
    patchPath: "inbox/factory-a1-test.patch",
    expectedBaseCommit: BASE_COMMIT,
    summary: "Patch produced; focused tests pass locally.",
    ...overrides,
  };
}

function controls(overrides: Partial<HandoffPacketControls> = {}): HandoffPacketControls {
  return {
    allowedPaths: ["docs/**"],
    forbiddenPaths: ["docs/private/**"],
    branchName: "factory/a1-test-handoff",
    commitMessage: "docs: apply factory handoff test patch",
    createPullRequest: true,
    validationProfile: "full",
    validationMode: "dry-run",
    ...overrides,
  };
}

/**
 * Minimal hermetic checker for the committed Operator task JSON Schema:
 * required keys, additionalProperties, type, const, enum, and pattern.
 */
interface SchemaProperty {
  type?: string | string[];
  const?: string;
  enum?: Array<string | null>;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  items?: { type: string; minLength?: number };
  uniqueItems?: boolean;
}

interface OperatorTaskSchema {
  required: string[];
  additionalProperties: boolean;
  properties: Record<string, SchemaProperty>;
}

function checkAgainstSchema(task: Record<string, unknown>, schema: OperatorTaskSchema): string[] {
  const violations: string[] = [];
  for (const key of schema.required) {
    if (!(key in task)) violations.push(`missing required property ${key}`);
  }
  for (const [key, value] of Object.entries(task)) {
    const property = schema.properties[key];
    if (!property) {
      if (!schema.additionalProperties) violations.push(`unexpected property ${key}`);
      continue;
    }
    if (property.const !== undefined && value !== property.const) {
      violations.push(`${key} must equal ${property.const}`);
    }
    if (property.enum && !property.enum.includes(value as string | null)) {
      violations.push(`${key} must be one of ${JSON.stringify(property.enum)}`);
    }
    if (typeof value === "string") {
      if (property.pattern && !new RegExp(property.pattern).test(value)) {
        violations.push(`${key} does not match ${property.pattern}`);
      }
      if (property.minLength !== undefined && value.length < property.minLength) {
        violations.push(`${key} is shorter than ${property.minLength}`);
      }
      if (property.maxLength !== undefined && value.length > property.maxLength) {
        violations.push(`${key} is longer than ${property.maxLength}`);
      }
    }
    if (Array.isArray(value)) {
      if (property.minItems !== undefined && value.length < property.minItems) {
        violations.push(`${key} has fewer than ${property.minItems} items`);
      }
      if (property.uniqueItems && new Set(value).size !== value.length) {
        violations.push(`${key} items are not unique`);
      }
    }
    if (property.type === "boolean" && typeof value !== "boolean") {
      violations.push(`${key} must be a boolean`);
    }
  }
  return violations;
}

describe("operator handoff", () => {
  it("refuses to build a handoff from a stopped routing decision", () => {
    const stopped = routeTaskPacket(metadata({ riskClass: "R3" }));
    expect(
      buildOperatorHandoff(metadata({ riskClass: "R3" }), stopped, execution(), controls()),
    ).toMatchObject({ ok: false, code: "decision_not_routed" });
  });

  it("refuses to build a handoff from a failed execution", () => {
    const decision = routeTaskPacket(metadata());
    expect(
      buildOperatorHandoff(metadata(), decision, execution({ status: "failed" }), controls()),
    ).toMatchObject({ ok: false, code: "execution_not_completed" });
  });

  it("fails closed on an invalid base commit", () => {
    const decision = routeTaskPacket(metadata());
    expect(
      buildOperatorHandoff(
        metadata(),
        decision,
        execution({ expectedBaseCommit: "not-a-sha" }),
        controls(),
      ),
    ).toMatchObject({ ok: false, code: "operator_task_invalid" });
  });

  it("fails closed on a patch outside the Operator inbox", () => {
    const decision = routeTaskPacket(metadata());
    expect(
      buildOperatorHandoff(
        metadata(),
        decision,
        execution({ patchPath: "../outside.patch" }),
        controls(),
      ),
    ).toMatchObject({ ok: false, code: "operator_task_invalid" });
  });

  it("never enables automatic merge and maps packet risk to a conservative floor", () => {
    const decision = routeTaskPacket(metadata({ riskClass: "R2" }));
    const result = buildOperatorHandoff(
      metadata({ riskClass: "R2" }),
      decision,
      execution(),
      controls(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.handoff.operatorTask.allowAutomaticMerge).toBe(false);
      expect(result.handoff.operatorTask.riskOverride).toBe("HIGH");
    }
  });

  it("rejects a hand-built task that enables automatic merge", () => {
    const forged: OperatorTask = {
      schemaVersion: "0.1",
      taskId: "FACTORY-A1-TEST",
      title: "Forged task",
      patchPath: "inbox/forged.patch",
      expectedBaseCommit: BASE_COMMIT,
      allowedPaths: ["docs/**"],
      forbiddenPaths: [],
      riskOverride: null,
      branchName: "factory/forged",
      commitMessage: "docs: forged",
      createPullRequest: false,
      allowAutomaticMerge: true,
      validationProfile: "quick",
    };
    expect(validateOperatorTask(forged)).toContain("allowAutomaticMerge must remain false.");
  });

  it("proves approved packet → model selection → handoff → Operator-compatible input", () => {
    const approvedPacket = metadata({ riskClass: "R1", title: "Hermetic proving packet" });

    const decision = routeTaskPacket(approvedPacket);
    expect(decision).toMatchObject({
      decision: "route",
      tier: "engineering",
      model: "Claude Opus 4.8",
    });

    const result = buildOperatorHandoff(approvedPacket, decision, execution(), controls());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { handoff } = result;
    expect(handoff.taskPacketId).toBe("FACTORY-A1-TEST");
    expect(handoff.selectedModel).toBe("Claude Opus 4.8");
    expect(handoff.selectedEffort).toBe("medium");
    expect(handoff.approvalState).toBe("approved");
    expect(handoff.selectionReasons.length).toBeGreaterThan(0);
    expect(handoff.validationInstructions.command).toContain("Invoke-ForeverOperator.ps1");
    expect(handoff.validationInstructions.command).toContain("-Mode dry-run");
    expect(handoff.ownerSummary).toContain("FACTORY-A1-TEST");
    expect(handoff.ownerSummary).toContain("medium effort");

    const schema = JSON.parse(
      readFileSync(join(process.cwd(), ".forever-factory", "task.schema.json"), "utf-8"),
    ) as OperatorTaskSchema;
    const violations = checkAgainstSchema(
      handoff.operatorTask as unknown as Record<string, unknown>,
      schema,
    );
    expect(violations).toEqual([]);
  });
});
