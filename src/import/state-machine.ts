import type { ImportState } from "./types";

const transitions: Record<ImportState, ImportState[]> = {
  initialized: ["manifest_loaded", "failed"],
  manifest_loaded: ["package_validated", "failed"],
  package_validated: ["datasets_loaded", "failed"],
  datasets_loaded: ["plan_created", "failed"],
  plan_created: ["relationships_validated", "failed"],
  relationships_validated: ["dry_run_completed", "executing", "failed"],
  dry_run_completed: ["completed"],
  executing: ["completed", "rolling_back", "failed"],
  rolling_back: ["rolled_back", "failed"],
  rolled_back: ["failed"],
  completed: [],
  failed: [],
};

export function transitionImportState(current: ImportState, next: ImportState): ImportState {
  if (!transitions[current].includes(next)) {
    throw new Error(`Invalid import state transition: ${current} -> ${next}`);
  }

  return next;
}

export function getImportStateMachine() {
  return transitions;
}
