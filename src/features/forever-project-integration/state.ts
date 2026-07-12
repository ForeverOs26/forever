/**
 * Forever Project Integration — lifecycle state and outcome enumerations.
 *
 * The closed vocabularies that describe where an integration run is in its
 * lifecycle and how it settled. Every value is explicit so downstream automation
 * stays deterministic and comparable — there are no free-text state strings.
 *
 * These are types and small pure predicates only. RC4.0 never transitions a
 * state at runtime, runs a stage, or advances a run over time; it defines the
 * vocabulary a future runtime will move an integration through, and the
 * {@link import("./derive").deriveProjectIntegrationState} mapping assigns one
 * deterministically from a run's counters.
 */

/**
 * The lifecycle state of an integration run.
 *
 * `pending`/`running` are pre-terminal; the rest are terminal outcomes a run
 * settles into. RC4.0 assigns them deterministically from stats and never
 * advances them over time.
 */
export type ProjectIntegrationState =
  | "pending"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "skipped"
  | "cancelled";

/** The terminal states an integration run can finish in. */
export const PROJECT_INTEGRATION_TERMINAL_STATES = [
  "succeeded",
  "partial",
  "failed",
  "skipped",
  "cancelled",
] as const satisfies readonly ProjectIntegrationState[];

/** Every {@link ProjectIntegrationState}, in a stable declared order. */
export const PROJECT_INTEGRATION_STATES = [
  "pending",
  "running",
  "succeeded",
  "partial",
  "failed",
  "skipped",
  "cancelled",
] as const satisfies readonly ProjectIntegrationState[];

/** Whether a state is terminal (the run has finished). */
export function isTerminalProjectIntegrationState(state: ProjectIntegrationState): boolean {
  return (PROJECT_INTEGRATION_TERMINAL_STATES as readonly ProjectIntegrationState[]).includes(state);
}

/** Runtime guard: whether a value is a known {@link ProjectIntegrationState}. */
export function isKnownProjectIntegrationState(value: unknown): value is ProjectIntegrationState {
  return (
    typeof value === "string" && (PROJECT_INTEGRATION_STATES as readonly string[]).includes(value)
  );
}

/**
 * The coarse outcome of a run, independent of its detailed lifecycle state.
 *
 * `noop` means nothing needed doing; `partial` means some steps completed and
 * some failed.
 */
export type ProjectIntegrationOutcome = "success" | "partial" | "failure" | "noop";

/** Whether an outcome represents a clean run (nothing failed). */
export function isSuccessfulProjectIntegrationOutcome(
  outcome: ProjectIntegrationOutcome,
): boolean {
  return outcome === "success" || outcome === "noop";
}
