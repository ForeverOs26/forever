import type { StudioJobStatus } from "../studio-types";

/**
 * Closed timing contract for one explicit Owner-controlled Retry.
 *
 * The 14-minute ceiling leaves a full minute inside the Owner Direct
 * Publication 15-minute target for the initial mutation, rendering, and the
 * Owner's next action. It is intentionally unrelated to dashboard polling.
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
