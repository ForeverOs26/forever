import type { TaskPacketRoutingMetadata } from "../model-router";
import type { ExecutionConnectorPacket, ExecutionSpec, HandoffControls } from "./contracts";

/**
 * Shared hermetic fixtures for the Execution Connector tests. No time, no
 * randomness, no I/O: every field is explicit so runs are fully deterministic.
 */

/** A real 40-character base commit (the FACTORY-A1-002 base) for handoff validity. */
export const BASE_COMMIT = "e4ae6f419f2777f3fc6b0754037af4821ab4fd88";

export function baseRouting(
  overrides: Partial<TaskPacketRoutingMetadata> = {},
): TaskPacketRoutingMetadata {
  return {
    schemaVersion: "0.1",
    taskPacketId: "FACTORY-A1-002-TEST",
    title: "Execution connector proving packet",
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

export interface PacketOverrides {
  routing?: Partial<TaskPacketRoutingMetadata>;
  execution?: Partial<ExecutionSpec>;
  handoff?: Partial<HandoffControls>;
}

export function basePacket(overrides: PacketOverrides = {}): ExecutionConnectorPacket {
  return {
    routing: baseRouting(overrides.routing),
    execution: {
      prompt: "Align the documentation index with the current factory state.",
      workingDirectory: "/repo",
      allowedScope: ["docs/**"],
      forbiddenActions: ["merge", "push", "open a pull request"],
      timeoutMs: 900000,
      expectedResultFormat: "patch",
      stopCondition: "Stop after producing the documentation patch.",
      expectedBaseCommit: BASE_COMMIT,
      ...overrides.execution,
    },
    handoff: {
      branchName: "factory/a1-002-connector-proving",
      commitMessage: "docs: apply execution connector proving patch",
      createPullRequest: true,
      forbiddenPaths: ["docs/private/**"],
      validationProfile: "full",
      validationMode: "dry-run",
      ...overrides.handoff,
    },
  };
}
