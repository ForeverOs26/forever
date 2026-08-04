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
 * ---------------------------------------------------------------------------
 * WHY THERE IS NOW ONE CANONICAL BOUNDARY (independent-review P1-3)
 * ---------------------------------------------------------------------------
 *
 * The reviewed design registered twelve mutations correctly and left the rest
 * unregistered, because registration was a thing each call site had to remember
 * to do. Enumerating from source found EIGHT unregistered production call
 * sites, three more than the review listed:
 *
 *   studioSaveProjectFacts, studioSetHeroImage, studioSetProjectPublication
 *   (in the project editor), studioSaveProjectAmenities, studioUpdateResale,
 *   studioSetListingPublication (in the resale editor), and both
 *   archive-upload calls — plus studioResumePending, which is worse in kind
 *   because it fires automatically on dashboard mount.
 *
 * Patching those call sites by hand would leave the same hazard for the next
 * mutation someone adds. So every Studio write now goes through ONE function,
 * `runStudioWriteAction`, and a contract test parses the real source to prove
 * it: a new `createServerFn({ method: "POST" })` that is not in the contract
 * table fails, and a call site outside the boundary fails.
 *
 * ---------------------------------------------------------------------------
 * WHAT "SETTLED" MEANS, AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------------------------------
 *
 * A write RESOLVING is proof the server answered. A write REJECTING is proof of
 * nothing on its own: a dropped response, an abort and a timeout all look the
 * same from the browser, and in every one of them the server may already have
 * applied the change. So a rejection whose shape does not prove the server
 * refused leaves the action UNRECONCILED, and an unreconciled action keeps this
 * page unsafe for automatic recovery until a READ-ONLY path establishes what
 * actually happened. Component unmount is not such a path, and never releases
 * anything.
 *
 * WHAT THIS IS. In-memory counters for THIS page. They deliberately do not
 * persist: after a reload nothing is resubmitted, so a record that survived
 * could only lie about a request that no longer exists.
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
 * a new mutation has to be added here deliberately, not inherited by accident,
 * and the contract test fails when one is not.
 */
export const STALE_ASSET_CONSEQUENTIAL_ACTIONS = [
  "upload_start",
  "upload_confirm",
  "job_processing",
  "resume_pending",
  "publication",
  "project_facts",
  "project_hero",
  "project_amenities",
  "resale_facts",
  "owner_retry_submit",
  "owner_retry_observe",
  "password_update",
  "member_change",
] as const;

export type StaleAssetConsequentialAction = (typeof STALE_ASSET_CONSEQUENTIAL_ACTIONS)[number];

/** Open actions, reference-counted so nested and concurrent writes both work. */
const open = new Map<StaleAssetConsequentialAction, number>();

/**
 * Actions whose SERVER OUTCOME is unknown.
 *
 * Separate from `open` because they are not in flight any more — the browser
 * has stopped waiting. They are simply unproven, and an unproven write is
 * exactly as unsafe to reload over as one still in flight.
 */
const unreconciled = new Map<StaleAssetConsequentialAction, number>();

/**
 * Marks a consequential action as started. The returned function marks it
 * settled and is safe to call more than once.
 *
 * Call it BEFORE the request leaves, never after: the dangerous window opens the
 * moment the browser might have sent something, not when a response arrives.
 *
 * Prefer `runStudioWriteAction`. This stays exported because the Owner Retry
 * lane holds a registration across two phases (submit, then observation) that
 * no single promise spans, and because the password update runs against the
 * Supabase recovery client rather than a Studio server function.
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

/**
 * Records that an action's server outcome could not be established.
 *
 * Fail-closed: this page stays unsafe for automatic recovery until a read-only
 * path reconciles it. It is in-memory, so a MANUAL reload clears it — which is
 * correct, because a manual reload is the visitor's decision and resubmits
 * nothing.
 */
export function markConsequentialActionUnreconciled(
  action: StaleAssetConsequentialAction,
): void {
  unreconciled.set(action, (unreconciled.get(action) ?? 0) + 1);
}

/**
 * Clears an unreconciled action after a READ-ONLY path established the truth.
 *
 * Only a read of current server state may call this. Nothing that writes, and
 * nothing that merely unmounts, ever does.
 */
export function reconcileConsequentialAction(action: StaleAssetConsequentialAction): void {
  unreconciled.delete(action);
}

/** True while ANY consequential action is in flight or unreconciled. */
export function hasUnprovenConsequentialAction(): boolean {
  for (const count of open.values()) if (count > 0) return true;
  for (const count of unreconciled.values()) if (count > 0) return true;
  return false;
}

/**
 * Which kinds are open or unreconciled, as a closed-vocabulary list. Used by
 * tests and by the bounded recovery record; never rendered and never persisted.
 */
export function openConsequentialActions(): StaleAssetConsequentialAction[] {
  const names = new Set<StaleAssetConsequentialAction>();
  for (const [action, count] of open) if (count > 0) names.add(action);
  for (const [action, count] of unreconciled) if (count > 0) names.add(action);
  return [...names].sort();
}

export function unreconciledConsequentialActions(): StaleAssetConsequentialAction[] {
  return [...unreconciled.entries()]
    .filter(([, count]) => count > 0)
    .map(([action]) => action)
    .sort();
}

/**
 * Whether a rejection proves the SERVER refused, or leaves the outcome unknown.
 *
 * Studio server functions surface a server-assigned snake_case `name`
 * (`job_not_found`, `job_already_published`, `studio_membership_required`,
 * `studio_request_failed`, …). A rejection carrying one of those is a reply:
 * the server processed the request and declined it, so nothing was applied and
 * the action is settled.
 *
 * Everything else — a `TypeError` from a dropped connection, an `AbortError`
 * from a cancelled request, a bare `Error` — proves only that the BROWSER
 * stopped waiting. The request may have arrived and been applied. Those are
 * unknown, and unknown is unsafe.
 */
const SERVER_ASSIGNED_ERROR_NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

export function studioWriteRejectionIsServerProven(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return SERVER_ASSIGNED_ERROR_NAME.test(error.name);
}

/**
 * THE CANONICAL STUDIO WRITE BOUNDARY.
 *
 * Every Studio mutation runs through here. The registration happens
 * SYNCHRONOUSLY, before `operation` is invoked and therefore before any network
 * dispatch can begin, which is the property the whole guarantee rests on.
 *
 *   - resolve                      -> settled, released;
 *   - reject, server-proven        -> settled, released;
 *   - reject, unknown/abort/timeout-> released from `open` but marked
 *                                     UNRECONCILED, so this page stays unsafe
 *                                     for automatic recovery;
 *   - nested and concurrent calls  -> reference-counted; the page stays unsafe
 *                                     until every one of them settles;
 *   - unmount                      -> nothing. Unmount is not an outcome.
 *
 * The original error is always re-thrown unchanged, so no caller's error
 * handling changes shape because of this boundary.
 */
export async function runStudioWriteAction<T>(
  action: StaleAssetConsequentialAction,
  operation: () => Promise<T>,
): Promise<T> {
  const release = beginConsequentialAction(action);
  try {
    const result = await operation();
    release();
    return result;
  } catch (error) {
    release();
    if (!studioWriteRejectionIsServerProven(error)) {
      markConsequentialActionUnreconciled(action);
    }
    throw error;
  }
}

/** Test-only reset. Never called by application code. */
export function resetConsequentialActionsForTest(): void {
  open.clear();
  unreconciled.clear();
}
