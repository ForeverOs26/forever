import { describe, expect, it } from "vitest";

import {
  routeTaskPacket,
  type PriorModelAttempt,
  type TaskPacketRoutingMetadata,
} from "./model-router";

function packet(overrides: Partial<TaskPacketRoutingMetadata> = {}): TaskPacketRoutingMetadata {
  return {
    schemaVersion: "0.1",
    taskPacketId: "FACTORY-A1-TEST",
    title: "Routing test packet",
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

function attempt(overrides: Partial<PriorModelAttempt> = {}): PriorModelAttempt {
  return {
    tier: "drafting",
    failureClass: "gate",
    diagnosis: "Changed-file lint failed on one file.",
    ...overrides,
  };
}

describe("factory model router", () => {
  it("routes routine bounded work to the drafting tier (Sonnet)", () => {
    expect(routeTaskPacket(packet())).toMatchObject({
      decision: "route",
      tier: "drafting",
      model: "Claude Sonnet 5.0",
      boundedRetry: false,
    });
  });

  it("routes R1 product work to the engineering tier (Opus)", () => {
    expect(routeTaskPacket(packet({ riskClass: "R1" }))).toMatchObject({
      decision: "route",
      tier: "engineering",
      model: "Claude Opus 4.8",
    });
  });

  it.each([
    ["medium ambiguity", { ambiguity: "medium" }],
    ["medium evidence sensitivity", { evidenceSensitivity: "medium" }],
    ["medium gate blindness", { gateBlindness: "medium" }],
    ["local architectural impact", { architecturalImpact: "local" }],
    ["a full working session", { estimatedDuration: "full-session" }],
    ["three affected subsystems", { affectedSubsystems: ["import", "database", "ui"] }],
  ] as Array<[string, Partial<TaskPacketRoutingMetadata>]>)(
    "routes %s to the engineering tier",
    (_label, overrides) => {
      expect(routeTaskPacket(packet(overrides))).toMatchObject({
        decision: "route",
        tier: "engineering",
        model: "Claude Opus 4.8",
      });
    },
  );

  it("refuses to route an unapproved packet", () => {
    expect(routeTaskPacket(packet({ approvalState: "proposed" }))).toMatchObject({
      decision: "stop",
      code: "packet_not_approved",
    });
  });

  it("parks high ambiguity instead of escalating", () => {
    expect(routeTaskPacket(packet({ ambiguity: "high" }))).toMatchObject({
      decision: "stop",
      code: "parked_ambiguity",
    });
  });

  it("parks canonical data impact classified below R2 as misclassified", () => {
    expect(routeTaskPacket(packet({ canonicalDataImpact: true, riskClass: "R1" }))).toMatchObject({
      decision: "stop",
      code: "parked_misclassification",
    });
  });

  it("routes correctly classified canonical data impact at engineering", () => {
    expect(routeTaskPacket(packet({ canonicalDataImpact: true, riskClass: "R2" }))).toMatchObject({
      decision: "route",
      tier: "engineering",
    });
  });

  it("stops after a prior security or scope failure", () => {
    expect(
      routeTaskPacket(packet({ priorModelAttempts: [attempt({ failureClass: "scope" })] })),
    ).toMatchObject({ decision: "stop", code: "stopped_security_or_scope" });
  });

  it("parks a mis-specified packet instead of escalating", () => {
    expect(
      routeTaskPacket(
        packet({ priorModelAttempts: [attempt({ failureClass: "mis-specification" })] }),
      ),
    ).toMatchObject({ decision: "stop", code: "parked_mis_specification" });
  });

  it("grants one bounded retry after a single diagnosable gate failure", () => {
    expect(routeTaskPacket(packet({ priorModelAttempts: [attempt()] }))).toMatchObject({
      decision: "route",
      tier: "drafting",
      boundedRetry: true,
    });
  });

  it("escalates to engineering after two drafting gate failures", () => {
    expect(routeTaskPacket(packet({ priorModelAttempts: [attempt(), attempt()] }))).toMatchObject({
      decision: "route",
      tier: "engineering",
      boundedRetry: false,
    });
  });

  it("escalates to engineering after a drafting capability failure", () => {
    expect(
      routeTaskPacket(packet({ priorModelAttempts: [attempt({ failureClass: "capability" })] })),
    ).toMatchObject({ decision: "route", tier: "engineering" });
  });

  it("stops for owner approval when engineering fails twice without Fable authorization", () => {
    const attempts = [attempt({ tier: "engineering" }), attempt({ tier: "engineering" })];
    expect(
      routeTaskPacket(packet({ riskClass: "R1", priorModelAttempts: attempts })),
    ).toMatchObject({ decision: "stop", code: "stop_pending_fable_approval" });
  });

  it("never routes a strategic packet to Fable without explicit authorization", () => {
    const result = routeTaskPacket(packet({ riskClass: "R3" }));
    expect(result).toMatchObject({ decision: "stop", code: "stop_pending_fable_approval" });
    if (result.decision === "stop") {
      expect(result.alternatives.length).toBeGreaterThan(0);
    }
  });

  it("treats Fable budget as restricted by default even when authorized", () => {
    expect(
      routeTaskPacket(
        packet({
          riskClass: "R3",
          fableAuthorization: { authorized: true, approvalRecord: "Owner 2026-07-14" },
        }),
      ),
    ).toMatchObject({ decision: "stop", code: "stop_fable_budget" });
  });

  it("routes to Fable only with authorization plus declared available budget", () => {
    expect(
      routeTaskPacket(
        packet({
          riskClass: "R3",
          fableAuthorization: { authorized: true, approvalRecord: "Owner 2026-07-14" },
          usageStates: { judgment: "available" },
        }),
      ),
    ).toMatchObject({ decision: "route", tier: "judgment", model: "Claude Fable 5.0" });
  });

  it("ignores a false fable authorization flag", () => {
    expect(
      routeTaskPacket(
        packet({
          gateBlindness: "high",
          fableAuthorization: { authorized: false, approvalRecord: "none" },
          usageStates: { judgment: "available" },
        }),
      ),
    ).toMatchObject({ decision: "stop", code: "stop_pending_fable_approval" });
  });

  it("routes one tier up when the drafting tier is exhausted", () => {
    expect(routeTaskPacket(packet({ usageStates: { drafting: "exhausted" } }))).toMatchObject({
      decision: "route",
      tier: "engineering",
    });
  });

  it("stops with alternatives when the engineering tier is exhausted", () => {
    expect(
      routeTaskPacket(packet({ riskClass: "R1", usageStates: { engineering: "exhausted" } })),
    ).toMatchObject({ decision: "stop", code: "stop_tier_exhausted" });
  });

  it("is deterministic for identical metadata", () => {
    const metadata = packet({
      riskClass: "R2",
      ambiguity: "medium",
      priorModelAttempts: [attempt({ tier: "engineering" })],
    });
    expect(routeTaskPacket(metadata)).toEqual(routeTaskPacket(metadata));
  });
});

function fableAuthorized(
  overrides: Partial<TaskPacketRoutingMetadata> = {},
): TaskPacketRoutingMetadata {
  return packet({
    riskClass: "R3",
    fableAuthorization: { authorized: true, approvalRecord: "Owner 2026-07-14" },
    usageStates: { judgment: "available" },
    ...overrides,
  });
}

describe("factory effort routing", () => {
  it("routes trivial mechanical drafting work to Sonnet low", () => {
    expect(routeTaskPacket(packet({ taskComplexity: "trivial" }))).toMatchObject({
      decision: "route",
      tier: "drafting",
      model: "Claude Sonnet 5.0",
      effort: "low",
    });
  });

  it("routes ordinary bounded drafting work to Sonnet medium by default", () => {
    expect(routeTaskPacket(packet())).toMatchObject({
      decision: "route",
      tier: "drafting",
      effort: "medium",
    });
  });

  it("routes complex but well-scoped drafting work to Sonnet high", () => {
    expect(routeTaskPacket(packet({ taskComplexity: "complex" }))).toMatchObject({
      decision: "route",
      tier: "drafting",
      effort: "high",
    });
  });

  it("routes bounded engineering work to Opus medium", () => {
    expect(routeTaskPacket(packet({ riskClass: "R1" }))).toMatchObject({
      decision: "route",
      tier: "engineering",
      model: "Claude Opus 4.8",
      effort: "medium",
    });
  });

  it("routes architecture-sensitive engineering work to Opus high by default", () => {
    expect(
      routeTaskPacket(packet({ riskClass: "R1", architecturalImpact: "local" })),
    ).toMatchObject({ decision: "route", tier: "engineering", effort: "high" });
  });

  it("routes Operator-touching engineering work to Opus high", () => {
    expect(
      routeTaskPacket(packet({ riskClass: "R1", affectedSubsystems: ["operator"] })),
    ).toMatchObject({ decision: "route", tier: "engineering", effort: "high" });
  });

  it("raises Opus high to Opus xhigh only with a recorded justification", () => {
    const result = routeTaskPacket(
      packet({
        riskClass: "R1",
        architecturalImpact: "local",
        requestedEffort: { effort: "xhigh", justification: "Long-running agentic migration." },
      }),
    );
    expect(result).toMatchObject({ decision: "route", tier: "engineering", effort: "xhigh" });
    if (result.decision === "route") {
      expect(
        result.reasons.some((reason) => reason.includes("Long-running agentic migration.")),
      ).toBe(true);
    }
  });

  it("does not raise to xhigh when the override lacks a justification", () => {
    expect(
      routeTaskPacket(
        packet({ riskClass: "R1", requestedEffort: { effort: "xhigh", justification: "  " } }),
      ),
    ).toMatchObject({ decision: "route", effort: "medium" });
  });

  it("routes strategic Fable work to high effort", () => {
    expect(routeTaskPacket(fableAuthorized())).toMatchObject({
      decision: "route",
      tier: "judgment",
      model: "Claude Fable 5.0",
      effort: "high",
    });
  });

  it("routes large multi-session Fable work to xhigh with a justification reason", () => {
    const result = routeTaskPacket(fableAuthorized({ estimatedDuration: "multi-session" }));
    expect(result).toMatchObject({ decision: "route", tier: "judgment", effort: "xhigh" });
    if (result.decision === "route") {
      expect(result.reasons.some((reason) => reason.toLowerCase().includes("multi-session"))).toBe(
        true,
      );
    }
  });

  it("blocks Fable without authorization regardless of effort", () => {
    expect(routeTaskPacket(packet({ riskClass: "R3" }))).toMatchObject({
      decision: "stop",
      code: "stop_pending_fable_approval",
    });
  });

  it("blocks max effort without Owner authorization", () => {
    expect(
      routeTaskPacket(
        packet({ requestedEffort: { effort: "max", justification: "Critical indivisible task." } }),
      ),
    ).toMatchObject({ decision: "stop", code: "stop_pending_max_approval" });
  });

  it("allows max effort only with an explicit Owner authorization record", () => {
    const result = routeTaskPacket(
      packet({
        requestedEffort: { effort: "max", justification: "Critical indivisible task." },
        maxAuthorization: { authorized: true, approvalRecord: "Owner 2026-07-14" },
      }),
    );
    expect(result).toMatchObject({ decision: "route", effort: "max" });
  });

  it("does not let tier exhaustion bypass max approval", () => {
    expect(
      routeTaskPacket(
        packet({
          usageStates: { drafting: "exhausted" },
          requestedEffort: { effort: "max", justification: "Escalated critical task." },
        }),
      ),
    ).toMatchObject({ decision: "stop", code: "stop_pending_max_approval" });
  });

  it("raises Sonnet medium to Sonnet high on a bounded retry", () => {
    expect(routeTaskPacket(packet({ priorModelAttempts: [attempt()] }))).toMatchObject({
      decision: "route",
      tier: "drafting",
      effort: "high",
      boundedRetry: true,
    });
  });

  it("produces identical model and effort for identical metadata", () => {
    const metadata = packet({
      riskClass: "R1",
      architecturalImpact: "local",
      correctnessCriticality: "high",
      requestedEffort: { effort: "xhigh", justification: "Recorded justification." },
    });
    const first = routeTaskPacket(metadata);
    const second = routeTaskPacket(metadata);
    expect(first).toEqual(second);
    if (first.decision === "route") {
      expect(first.model).toBe("Claude Opus 4.8");
      expect(first.effort).toBe("xhigh");
    }
  });
});
