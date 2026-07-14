import {
  AUTOMATIC_EFFORT_CAP,
  DEFAULT_USAGE_STATES,
  FACTORY_MODEL_ROUTING_TABLE,
  WORKER_TIER_ORDER,
  effortRank,
  tierAbove,
  tierRank,
  type EffortLevel,
  type ModelUsageState,
  type WorkerTier,
} from "./routing-table";

/**
 * Deterministic Claude model and effort routing for approved Task Packets.
 *
 * Implements the ratified rule of `docs/factory/FACTORY_ROUTING_POLICY.md`:
 * route to `max(risk floor, ambiguity floor, evidence sensitivity, gate
 * blindness)`, park mis-specified or highly ambiguous work instead of
 * escalating, and never select the judgment tier (Fable) without explicit
 * Owner authorization plus Owner-declared available budget.
 *
 * The router selects both a model tier and a reasoning-effort level. Effort is
 * derived deterministically from explicit classification metadata; `xhigh`
 * always carries a concrete justification in the reasons, and `max` is never
 * reached automatically — it requires an explicit Owner authorization record.
 *
 * The router only decides; it never invokes a model, and at A0 every packet
 * it routes has already been Owner-approved.
 */

export type RiskClass = "R0" | "R1" | "R2" | "R3";
export type ClassificationLevel = "low" | "medium" | "high";
export type ArchitecturalImpact = "none" | "local" | "systemic";
export type EstimatedDuration = "bounded" | "full-session" | "multi-session";
export type TaskComplexity = "trivial" | "ordinary" | "complex";

/**
 * An Owner-supplied effort override. `effort` never lowers the deterministic
 * baseline (the router takes the stronger of the two); `xhigh` requires a
 * non-empty `justification`, and `max` additionally requires an Owner
 * authorization record on the packet.
 */
export interface EffortOverride {
  effort: EffortLevel;
  justification: string;
}

export type AttemptFailureClass =
  | "gate"
  | "capability"
  | "mis-specification"
  | "environment"
  | "security"
  | "scope";

/**
 * Carry-forward record of a failed model attempt, per the escalation policy:
 * the original packet plus diff, gate failures, and a concise diagnosis.
 */
export interface PriorModelAttempt {
  tier: WorkerTier;
  failureClass: AttemptFailureClass;
  diagnosis: string;
  patchPath?: string;
  gateFailures?: string[];
}

export type PacketApprovalState =
  | "proposed"
  | "approved"
  | "in-progress"
  | "parked"
  | "completed"
  | "rejected";

/**
 * Routing metadata mirrors the "Classification and routing" section of
 * `docs/factory/TASK_PACKET_TEMPLATE.md`, in the camelCase field style of the
 * Operator task contract (`.forever-factory/task.schema.json`). Explicit
 * fields, never free-text inference, drive the decision.
 */
export interface TaskPacketRoutingMetadata {
  schemaVersion: "0.1";
  taskPacketId: string;
  title: string;
  approvalState: PacketApprovalState;
  riskClass: RiskClass;
  ambiguity: ClassificationLevel;
  evidenceSensitivity: ClassificationLevel;
  gateBlindness: ClassificationLevel;
  taskScope: string;
  taskComplexity: TaskComplexity;
  affectedSubsystems: string[];
  expectedFiles?: number;
  estimatedDuration: EstimatedDuration;
  architecturalImpact: ArchitecturalImpact;
  canonicalDataImpact: boolean;
  correctnessCriticality?: ClassificationLevel;
  priorModelAttempts: PriorModelAttempt[];
  fableAuthorization?: { authorized: boolean; approvalRecord: string };
  maxAuthorization?: { authorized: boolean; approvalRecord: string };
  requestedEffort?: EffortOverride;
  usageStates?: Partial<Record<WorkerTier, ModelUsageState>>;
}

export type RoutingStopCode =
  | "packet_not_approved"
  | "parked_misclassification"
  | "parked_mis_specification"
  | "parked_ambiguity"
  | "stopped_security_or_scope"
  | "retry_budget_exhausted"
  | "stop_pending_fable_approval"
  | "stop_fable_budget"
  | "stop_pending_max_approval"
  | "stop_tier_exhausted";

export type RoutingDecision =
  | {
      decision: "route";
      tier: WorkerTier;
      model: string;
      effort: EffortLevel;
      boundedRetry: boolean;
      reasons: string[];
    }
  | {
      decision: "stop";
      code: RoutingStopCode;
      reasons: string[];
      alternatives: string[];
    };

const FABLE_ALTERNATIVES: string[] = [
  "Decompose the packet into bounded sub-packets routable to lower tiers.",
  "Reduce the packet scope until it fits the engineering tier.",
  "Execute at the engineering tier (Claude Opus 4.8) with Owner review.",
  "Record an explicit Owner blocker in docs/factory/OWNER_QUEUE.md.",
];

function stop(
  code: RoutingStopCode,
  reasons: string[],
  alternatives: string[] = [],
): RoutingDecision {
  return { decision: "stop", code, reasons, alternatives };
}

interface Floor {
  tier: WorkerTier;
  reason: string;
}

const RISK_FLOORS: Record<RiskClass, WorkerTier> = {
  R0: "drafting",
  R1: "engineering",
  R2: "engineering",
  R3: "judgment",
};

const LEVEL_FLOORS: Record<Exclude<ClassificationLevel, "high">, WorkerTier> = {
  low: "drafting",
  medium: "engineering",
};

const IMPACT_FLOORS: Record<ArchitecturalImpact, WorkerTier> = {
  none: "drafting",
  local: "engineering",
  systemic: "judgment",
};

const DURATION_FLOORS: Record<EstimatedDuration, WorkerTier> = {
  bounded: "drafting",
  "full-session": "engineering",
  "multi-session": "judgment",
};

function collectFloors(metadata: TaskPacketRoutingMetadata): Floor[] {
  const floors: Floor[] = [
    {
      tier: RISK_FLOORS[metadata.riskClass],
      reason: `Risk class ${metadata.riskClass} sets a ${RISK_FLOORS[metadata.riskClass]} floor.`,
    },
  ];
  if (metadata.ambiguity !== "high") {
    floors.push({
      tier: LEVEL_FLOORS[metadata.ambiguity],
      reason: `Ambiguity ${metadata.ambiguity} sets a ${LEVEL_FLOORS[metadata.ambiguity]} floor.`,
    });
  }
  const evidenceTier: WorkerTier =
    metadata.evidenceSensitivity === "high"
      ? "judgment"
      : LEVEL_FLOORS[metadata.evidenceSensitivity];
  floors.push({
    tier: evidenceTier,
    reason: `Evidence sensitivity ${metadata.evidenceSensitivity} sets a ${evidenceTier} floor.`,
  });
  const gateTier: WorkerTier =
    metadata.gateBlindness === "high" ? "judgment" : LEVEL_FLOORS[metadata.gateBlindness];
  floors.push({
    tier: gateTier,
    reason: `Gate blindness ${metadata.gateBlindness} sets a ${gateTier} floor.`,
  });
  floors.push({
    tier: IMPACT_FLOORS[metadata.architecturalImpact],
    reason: `Architectural impact ${metadata.architecturalImpact} sets a ${IMPACT_FLOORS[metadata.architecturalImpact]} floor.`,
  });
  floors.push({
    tier: DURATION_FLOORS[metadata.estimatedDuration],
    reason: `Estimated duration ${metadata.estimatedDuration} sets a ${DURATION_FLOORS[metadata.estimatedDuration]} floor.`,
  });
  if (metadata.affectedSubsystems.length >= 3) {
    floors.push({
      tier: "engineering",
      reason: `${metadata.affectedSubsystems.length} affected subsystems set an engineering floor.`,
    });
  }
  if (metadata.canonicalDataImpact) {
    floors.push({
      tier: "engineering",
      reason: "Canonical data impact sets an engineering floor.",
    });
  }
  return floors;
}

function escalationFromAttempts(
  attempts: PriorModelAttempt[],
): { tier: WorkerTier; reason: string; boundedRetry: boolean } | { exhausted: WorkerTier } | null {
  let result: { tier: WorkerTier; reason: string; boundedRetry: boolean } | null = null;
  for (const tier of WORKER_TIER_ORDER) {
    const atTier = attempts.filter((attempt) => attempt.tier === tier);
    if (atTier.length === 0) continue;
    const gateFailures = atTier.filter((attempt) => attempt.failureClass === "gate").length;
    const capabilityFailures = atTier.filter(
      (attempt) => attempt.failureClass === "capability",
    ).length;
    if (capabilityFailures >= 1 || gateFailures >= 2) {
      const next = tierAbove(tier);
      if (!next) return { exhausted: tier };
      const cause =
        capabilityFailures >= 1
          ? `a capability failure at the ${tier} tier`
          : `two gate-cycle failures at the ${tier} tier`;
      result = {
        tier: next,
        reason: `Escalated one tier after ${cause}.`,
        boundedRetry: false,
      };
    } else if (gateFailures === 1) {
      const candidate = {
        tier,
        reason: `One bounded retry at the ${tier} tier after a single diagnosable gate failure.`,
        boundedRetry: true,
      };
      if (!result || tierRank(candidate.tier) > tierRank(result.tier)) result = candidate;
    }
  }
  return result;
}

/** Signals that make engineering-tier work architecture-sensitive or wide. */
function engineeringHighSignals(metadata: TaskPacketRoutingMetadata): string[] {
  const signals: string[] = [];
  if (metadata.architecturalImpact !== "none") {
    signals.push(`architecture-sensitive (${metadata.architecturalImpact}) work`);
  }
  if (metadata.affectedSubsystems.length >= 3) {
    signals.push(`repository-wide work across ${metadata.affectedSubsystems.length} subsystems`);
  }
  if (metadata.affectedSubsystems.some((subsystem) => /operator/i.test(subsystem))) {
    signals.push("Operator-touching work");
  }
  if ((metadata.expectedFiles ?? 0) >= 5) {
    signals.push(`multi-file work (${metadata.expectedFiles} files)`);
  }
  if (metadata.taskComplexity === "complex") {
    signals.push("complex implementation");
  }
  return signals;
}

/**
 * Deterministic baseline effort for the finalized tier, before correctness,
 * retry, and Owner-override adjustments. Automatic effort never exceeds
 * `AUTOMATIC_EFFORT_CAP` (high) except the judgment tier's large-autonomous
 * `xhigh`, which carries its own concrete justification.
 */
function baselineEffort(
  tier: WorkerTier,
  metadata: TaskPacketRoutingMetadata,
): { effort: EffortLevel; reasons: string[] } {
  if (tier === "drafting") {
    if (metadata.taskComplexity === "trivial") {
      return { effort: "low", reasons: ["Trivial mechanical drafting work maps to low effort."] };
    }
    if (metadata.taskComplexity === "complex") {
      return {
        effort: "high",
        reasons: ["Complex but well-scoped drafting work maps to high effort."],
      };
    }
    return { effort: "medium", reasons: ["Ordinary bounded drafting work maps to medium effort."] };
  }

  if (tier === "engineering") {
    const signals = engineeringHighSignals(metadata);
    if (signals.length > 0) {
      return {
        effort: "high",
        reasons: [`Engineering high effort: ${signals.join("; ")}.`],
      };
    }
    return {
      effort: "medium",
      reasons: ["Bounded or moderately complex engineering work maps to medium effort."],
    };
  }

  // judgment (Fable)
  if (metadata.estimatedDuration === "multi-session") {
    return {
      effort: "xhigh",
      reasons: [
        "Judgment xhigh effort: large autonomous, multi-session strategic work justifies xhigh.",
      ],
    };
  }
  return { effort: "high", reasons: ["Strategic judgment work maps to high effort."] };
}

type EffortResult =
  | { ok: true; effort: EffortLevel; reasons: string[] }
  | { ok: false; code: "stop_pending_max_approval"; reason: string };

/**
 * Applies correctness criticality, the bounded-retry bump, and any Owner
 * effort override on top of the baseline. Never silently increases to max:
 * `max` requires an explicit Owner authorization record, and `xhigh` requires
 * a concrete justification recorded in the reasons.
 */
function selectEffort(
  tier: WorkerTier,
  metadata: TaskPacketRoutingMetadata,
  boundedRetry: boolean,
): EffortResult {
  const base = baselineEffort(tier, metadata);
  let effort = base.effort;
  const reasons = [...base.reasons];

  const raiseToCap = (reason: string) => {
    if (effortRank(effort) < effortRank(AUTOMATIC_EFFORT_CAP)) {
      effort = AUTOMATIC_EFFORT_CAP;
      reasons.push(reason);
    }
  };

  if (metadata.correctnessCriticality === "high") {
    raiseToCap("High correctness criticality raises effort to high.");
  }
  if (boundedRetry) {
    raiseToCap("Bounded retry after a local diagnosable failure raises effort to high.");
  }

  const override = metadata.requestedEffort;
  if (override) {
    if (override.effort === "max") {
      if (metadata.maxAuthorization?.authorized !== true) {
        return {
          ok: false,
          code: "stop_pending_max_approval",
          reason: "Max effort requires an explicit Owner authorization record; none is present.",
        };
      }
      effort = "max";
      reasons.push(
        `Max effort authorized by Owner (${metadata.maxAuthorization.approvalRecord}): ${override.justification}`,
      );
    } else if (effortRank(override.effort) > effortRank(effort)) {
      if (override.effort === "xhigh") {
        if (override.justification.trim().length > 0) {
          effort = "xhigh";
          reasons.push(`xhigh effort requested with justification: ${override.justification}`);
        } else {
          reasons.push(`xhigh requested without justification; capped at ${effort} effort.`);
        }
      } else {
        effort = override.effort;
        reasons.push(`Owner requested ${override.effort} effort.`);
      }
    }
  }

  return { ok: true, effort, reasons };
}

export function routeTaskPacket(metadata: TaskPacketRoutingMetadata): RoutingDecision {
  if (metadata.approvalState !== "approved") {
    return stop("packet_not_approved", [
      `Packet ${metadata.taskPacketId} is ${metadata.approvalState}; at A0 only an Owner-approved packet may be routed.`,
    ]);
  }

  if (
    metadata.canonicalDataImpact &&
    (metadata.riskClass === "R0" || metadata.riskClass === "R1")
  ) {
    return stop("parked_misclassification", [
      "Canonical data impact makes the packet R2 by definition (Constitution §7); reclassify before routing.",
    ]);
  }

  const securityAttempt = metadata.priorModelAttempts.find(
    (attempt) => attempt.failureClass === "security" || attempt.failureClass === "scope",
  );
  if (securityAttempt) {
    return stop("stopped_security_or_scope", [
      `A prior ${securityAttempt.failureClass} failure stops the run: ${securityAttempt.diagnosis}`,
    ]);
  }

  const misSpecified = metadata.priorModelAttempts.find(
    (attempt) => attempt.failureClass === "mis-specification",
  );
  if (misSpecified) {
    return stop("parked_mis_specification", [
      `Mis-specification parks the packet instead of escalating: ${misSpecified.diagnosis}`,
    ]);
  }

  if (metadata.ambiguity === "high") {
    return stop("parked_ambiguity", [
      "High ambiguity is not solved by a stronger model; park the packet and obtain Owner clarification.",
    ]);
  }

  const floors = collectFloors(metadata);
  let tier: WorkerTier = "drafting";
  for (const floor of floors) {
    if (tierRank(floor.tier) > tierRank(tier)) tier = floor.tier;
  }
  const reasons = floors.filter((floor) => floor.tier === tier).map((floor) => floor.reason);

  let boundedRetry = false;
  const escalation = escalationFromAttempts(metadata.priorModelAttempts);
  if (escalation && "exhausted" in escalation) {
    return stop(
      "retry_budget_exhausted",
      [
        `The ${escalation.exhausted} tier has already failed its retry budget; no higher tier exists.`,
      ],
      FABLE_ALTERNATIVES,
    );
  }
  if (escalation && tierRank(escalation.tier) >= tierRank(tier)) {
    tier = escalation.tier;
    boundedRetry = escalation.boundedRetry;
    reasons.push(escalation.reason);
  }

  const usageStates = { ...DEFAULT_USAGE_STATES, ...metadata.usageStates };

  if (tier === "judgment") {
    if (metadata.fableAuthorization?.authorized !== true) {
      return stop(
        "stop_pending_fable_approval",
        [
          ...reasons,
          "The judgment tier (Fable) requires explicit Owner authorization; none is recorded on the packet.",
        ],
        FABLE_ALTERNATIVES,
      );
    }
    if (usageStates.judgment !== "available") {
      return stop(
        "stop_fable_budget",
        [
          ...reasons,
          `Fable usage state is "${usageStates.judgment}"; the Owner must declare it available before routing.`,
        ],
        FABLE_ALTERNATIVES,
      );
    }
    reasons.push(
      `Fable authorized by Owner approval record: ${metadata.fableAuthorization.approvalRecord}`,
    );
  } else if (usageStates[tier] === "exhausted") {
    const next = tierAbove(tier);
    if (next && next !== "judgment") {
      reasons.push(`The ${tier} tier is exhausted; routed one tier up.`);
      tier = next;
    } else {
      return stop(
        "stop_tier_exhausted",
        [...reasons, `The ${tier} tier is exhausted and the next tier requires Owner approval.`],
        FABLE_ALTERNATIVES,
      );
    }
  }

  const effortResult = selectEffort(tier, metadata, boundedRetry);
  if (!effortResult.ok) {
    return stop("stop_pending_max_approval", [...reasons, effortResult.reason]);
  }

  return {
    decision: "route",
    tier,
    model: FACTORY_MODEL_ROUTING_TABLE[tier],
    effort: effortResult.effort,
    boundedRetry,
    reasons: [...reasons, ...effortResult.reasons],
  };
}
