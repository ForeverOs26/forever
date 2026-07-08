import type { DatabaseLayer } from "./database";
import type { ImportPlan, RollbackPlan } from "./types";

export function createRollbackPlan(plan: ImportPlan): RollbackPlan {
  if (plan.mode === "dry-run") {
    return {
      supported: true,
      strategy: "not_required",
      steps: [],
      notes: ["Dry-run performs no database writes."],
    };
  }

  return {
    supported: true,
    strategy: "compensating_actions",
    steps: [...plan.operations].reverse().map((operation) => ({
      entity: operation.entity,
      naturalKey: operation.naturalKey,
      strategy: operation.action === "insert" ? "delete_inserted" : "restore_previous",
      reason: "Undo in reverse dependency order if execution fails after this operation.",
    })),
    notes: [
      "Initial skeleton records rollback intent but does not delete or mutate rows automatically.",
      "Database writes remain idempotent upserts until transaction-scoped rollback is implemented.",
    ],
  };
}

export async function rollbackImport(database: DatabaseLayer, rollbackPlan: RollbackPlan) {
  void database;
  return {
    rolledBack: false,
    plan: rollbackPlan,
    reason:
      "Rollback execution is prepared as an interface and intentionally disabled until transaction support is added.",
  };
}
