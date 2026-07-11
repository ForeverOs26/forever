/**
 * Forever Pipeline — lifecycle state and outcome enumerations.
 *
 * The closed vocabularies that describe where a pipeline run is in its lifecycle
 * and how it settled. Every value is explicit so downstream automation stays
 * deterministic and comparable — there are no free-text state strings.
 *
 * These are types and small pure predicates only. RC3.5 never transitions a
 * state at runtime, runs a stage, or advances a run over time; it defines the
 * vocabulary a future runtime will move a pipeline through, and the
 * {@link import("./derive").derivePipelineState} mapping assigns one
 * deterministically from a run's counters.
 */

/**
 * The lifecycle state of a pipeline run.
 *
 * `pending`/`running` are pre-terminal; the rest are terminal outcomes a run
 * settles into. RC3.5 assigns them deterministically from stats and never
 * advances them over time.
 */
export type PipelineState =
  | "pending"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "skipped"
  | "cancelled";

/** The terminal states a pipeline run can finish in. */
export const PIPELINE_TERMINAL_STATES = [
  "succeeded",
  "partial",
  "failed",
  "skipped",
  "cancelled",
] as const satisfies readonly PipelineState[];

/** Every {@link PipelineState}, in a stable declared order. */
export const PIPELINE_STATES = [
  "pending",
  "running",
  "succeeded",
  "partial",
  "failed",
  "skipped",
  "cancelled",
] as const satisfies readonly PipelineState[];

/** Whether a state is terminal (the run has finished). */
export function isTerminalPipelineState(state: PipelineState): boolean {
  return (PIPELINE_TERMINAL_STATES as readonly PipelineState[]).includes(state);
}

/** Runtime guard: whether a value is a known {@link PipelineState}. */
export function isKnownPipelineState(value: unknown): value is PipelineState {
  return typeof value === "string" && (PIPELINE_STATES as readonly string[]).includes(value);
}

/**
 * The coarse outcome of a run, independent of its detailed lifecycle state.
 *
 * `noop` means nothing needed doing; `partial` means some steps completed and
 * some failed.
 */
export type PipelineOutcome = "success" | "partial" | "failure" | "noop";

/** Whether an outcome represents a clean run (nothing failed). */
export function isSuccessfulPipelineOutcome(outcome: PipelineOutcome): boolean {
  return outcome === "success" || outcome === "noop";
}
