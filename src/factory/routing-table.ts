/**
 * Replaceable role-to-model mapping for the Forever Factory model router.
 *
 * Per `docs/factory/FACTORY_ROUTING_POLICY.md` and Constitution §10, roles are
 * permanent policy concepts while model names are operational configuration.
 * Update this table — never the routing logic — when the mapping changes.
 *
 * The router selects among the Claude worker tiers only. The repository
 * integration tier (Codex) is not a router target: integration mechanics are
 * the Forever Operator's domain and remain outside automated model selection.
 */

export type WorkerTier = "drafting" | "engineering" | "judgment";

export const WORKER_TIER_ORDER: readonly WorkerTier[] = ["drafting", "engineering", "judgment"];

export const FACTORY_MODEL_ROUTING_TABLE: Record<WorkerTier, string> = {
  drafting: "Claude Sonnet 5.0",
  engineering: "Claude Opus 4.8",
  judgment: "Claude Fable 5.0",
};

/**
 * Usage state is an honest coarse representation. The Factory never fabricates
 * exact remaining provider budget; only the Owner or the provider may supply
 * finer detail. The judgment tier (Fable) is "restricted" unless the Owner
 * explicitly declares it available.
 */
export type ModelUsageState = "available" | "restricted" | "exhausted" | "unknown";

export const DEFAULT_USAGE_STATES: Record<WorkerTier, ModelUsageState> = {
  drafting: "unknown",
  engineering: "unknown",
  judgment: "restricted",
};

export function tierRank(tier: WorkerTier): number {
  return WORKER_TIER_ORDER.indexOf(tier);
}

export function tierAbove(tier: WorkerTier): WorkerTier | undefined {
  return WORKER_TIER_ORDER[tierRank(tier) + 1];
}

/**
 * Deterministic reasoning-effort levels, ordered from cheapest to strongest.
 * `xhigh` always requires a concrete justification recorded in the routing
 * reasons; `max` is never reached automatically and requires explicit Owner
 * authorization regardless of tier.
 */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export const EFFORT_ORDER: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

/** Highest effort the router may reach automatically, without an override. */
export const AUTOMATIC_EFFORT_CAP: EffortLevel = "high";

export function effortRank(effort: EffortLevel): number {
  return EFFORT_ORDER.indexOf(effort);
}
