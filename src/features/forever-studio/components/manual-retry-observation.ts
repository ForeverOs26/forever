import type { StudioJobStatus } from "../studio-types";

/**
 * Closed timing contract for one explicit Owner-controlled Retry.
 *
 * `totalTimeoutMs` is ONE ABSOLUTE DEADLINE for the whole action, measured from
 * the moment the Owner presses Retry — before the mutation is sent, not after
 * it answers. Submission and observation spend the same budget:
 *
 *   deadline = retry action started + totalTimeoutMs
 *
 * so a submission that consumes four minutes leaves ten for observation, and a
 * submission that never settles at all still ends in a truthful bounded state
 * instead of sitting in `submitting` forever. Giving each phase its own fresh
 * allowance is what let the total exceed the Owner's 15-minute target.
 *
 * The 14-minute ceiling leaves a full minute inside the Owner Direct
 * Publication 15-minute target for rendering and the Owner's next action. It is
 * intentionally unrelated to dashboard polling.
 */
export const STUDIO_OWNER_RETRY_OBSERVATION = Object.freeze({
  initialIntervalMs: 1_000,
  maximumIntervalMs: 5_000,
  totalTimeoutMs: 14 * 60 * 1_000,
});

export type StudioOwnerRetryPhase =
  | "submitting"
  | "observing"
  | "published"
  | "failed"
  | "terminally_nonretryable"
  | "missing"
  | "timeout"
  | "refreshing";

export interface StudioOwnerRetryView {
  phase: StudioOwnerRetryPhase;
  status: StudioJobStatus;
  message: string;
  errorCode: string | null;
  errorStage: string | null;
  attemptCount: number;
  retryable: boolean;
  pagePath: string | null;
}

export function nextOwnerRetryInterval(currentMs: number): number {
  return Math.min(STUDIO_OWNER_RETRY_OBSERVATION.maximumIntervalMs, currentMs * 2);
}

export function ownerRetryIsBusy(view: StudioOwnerRetryView | undefined): boolean {
  return view?.phase === "submitting" || view?.phase === "observing";
}
