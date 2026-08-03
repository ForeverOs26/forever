/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — write-action safety.
 *
 * THE RULE THIS ENFORCES. An automatic reload must never create a second
 * consequential action. Recovering from a version change is a convenience;
 * publishing twice, retrying a job twice, starting a second upload or replaying
 * a password update is a real, unrecoverable harm. So the reload is refused
 * outright whenever the application cannot prove that no consequential request
 * is in flight — and "cannot prove" is the default, not the exception.
 *
 * WHAT THIS IS. An in-memory count of consequential actions currently open in
 * THIS page. It deliberately does not persist: after a reload nothing is
 * resubmitted, so a marker that survived would only be able to lie about a
 * request that no longer exists.
 *
 * WHAT RECOVERY DOES INSTEAD. Nothing automatic. The visitor is shown the
 * bounded recovery screen and reloads by hand when they are ready, and the
 * existing read-only status paths — the Owner Retry observation view, the
 * dashboard overview poll — report what actually happened. No mutation, no
 * Retry, no upload and no publication ever restarts on its own.
 *
 * INTEGRATION WITH OWNER RETRY. `manual-retry-observation.ts` already treats an
 * unconfirmed Retry as unconfirmed: one absolute deadline covers submission and
 * observation, and an unsettled submit ends in a truthful `timeout` state that
 * explicitly refuses to resubmit. This module does not weaken that lock, does
 * not shorten that deadline and does not let a reload become a second Retry: it
 * only ensures the page cannot be reloaded out from under it.
 */

/**
 * Every consequential action recovery must stand clear of. Closed on purpose —
 * a new mutation has to be added here deliberately, not inherited by accident.
 */
export const STALE_ASSET_CONSEQUENTIAL_ACTIONS = [
  "upload_start",
  "upload_confirm",
  "publication",
  "owner_retry_submit",
  "owner_retry_observe",
  "password_update",
  "member_change",
] as const;

export type StaleAssetConsequentialAction = (typeof STALE_ASSET_CONSEQUENTIAL_ACTIONS)[number];

const open = new Map<StaleAssetConsequentialAction, number>();

/**
 * Marks a consequential action as started. The returned function marks it
 * settled and is safe to call more than once.
 *
 * Call it BEFORE the request leaves, never after: the dangerous window opens the
 * moment the browser might have sent something, not when a response arrives.
 */
export function beginConsequentialAction(action: StaleAssetConsequentialAction): () => void {
  open.set(action, (open.get(action) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (open.get(action) ?? 1) - 1;
    if (remaining > 0) open.set(action, remaining);
    else open.delete(action);
  };
}

/** True while ANY consequential action's outcome is unproven in this page. */
export function hasUnprovenConsequentialAction(): boolean {
  for (const count of open.values()) if (count > 0) return true;
  return false;
}

/**
 * Which kinds are open, as a closed-vocabulary list. Used by tests and by the
 * bounded recovery record; never rendered and never persisted.
 */
export function openConsequentialActions(): StaleAssetConsequentialAction[] {
  return [...open.entries()]
    .filter(([, count]) => count > 0)
    .map(([action]) => action)
    .sort();
}

/** Test-only reset. Never called by application code. */
export function resetConsequentialActionsForTest(): void {
  open.clear();
}
