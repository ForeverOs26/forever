/**
 * Forever Sync — the validatable plan shape.
 *
 * A sync run is validated as a *plan*: the declarative job plus the policy,
 * schedules, and triggers that govern it, and (optionally) the canonical
 * payload it would move. The payload and its reference scope reuse the Forever
 * Import (RC3.1) types verbatim, so a sync payload is validated by the exact
 * same rules that guard an import — no parallel validation logic.
 */

import type { ImportBatch, ReferenceScope } from "@/features/forever-import";

import type { SyncPolicy } from "../policy";
import type { SyncSchedule, SyncTrigger } from "../schedule";
import type { SyncJob } from "../types";

/** Everything a single validation pass needs to judge a sync run. */
export interface SyncPlan {
  job: SyncJob;
  policy?: SyncPolicy;
  schedules?: SyncSchedule[];
  triggers?: SyncTrigger[];
  /** Canonical records the run would move, reusing the RC3.1 import batch. */
  payload?: ImportBatch;
  /** Ids known outside the payload, reusing the RC3.1 reference scope. */
  scope?: ReferenceScope;
}
