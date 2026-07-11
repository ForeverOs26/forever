/**
 * Forever Sync — job abstraction.
 *
 * A *sync job handler* is the unit a future synchronizer plugs into: it obtains
 * already-materialized canonical records, hands them to a {@link SyncConnector}
 * for planning, and validates the plan against the job, its policy, and the
 * canonical payload. External systems (a website read model, a CRM export, a
 * marketplace feed) connect through this one interface.
 *
 * The foundation performs no IO and no writes: obtaining the records is an
 * abstract `collect()` that concrete jobs implement outside RC3.2. This ships
 * the wiring — connector → validation → result — not the data movement.
 */

import type { ImportBatch, ReferenceScope } from "@/features/forever-import";

import { deriveSyncOutcome, deriveSyncStatus } from "../derive";
import { partitionSyncIssues } from "../result";
import type { SyncContext, SyncJob, SyncResult, SyncStats } from "../types";
import type { SyncPolicy } from "../policy";
import { validateSyncPlan } from "../validation";
import type { SyncConnector } from "./connector";

/** The contract every sync job handler satisfies. */
export interface SyncJobHandler<T> {
  /** The declarative job this handler plans. */
  readonly job: SyncJob;
  /** Plan the sync as a fully-reported {@link SyncResult}. */
  plan(context: SyncContext): SyncResult<T>;
}

/**
 * Template-method base that wires connector → validation → result.
 *
 * Concrete jobs supply three things: the {@link job}, a {@link collect} that
 * returns already-materialized records, and a {@link toBatch} that places the
 * planned records into the right {@link ImportBatch} slot. The base owns the
 * orchestration and the deterministic merging of connector and validation
 * issues — mirroring the Forever Import (RC3.1) source template so the two
 * foundations behave identically.
 */
export abstract class AbstractSyncJob<T> implements SyncJobHandler<T> {
  abstract readonly job: SyncJob;

  constructor(
    protected readonly connector: SyncConnector<T>,
    protected readonly policy: SyncPolicy,
  ) {}

  /**
   * Return already-materialized records for the connector to plan.
   * Implementations own their IO *outside* the foundation and pass the
   * structured records in here; the base never touches the network or
   * filesystem.
   */
  protected abstract collect(context: SyncContext): readonly T[];

  /** Place planned records into the batch slot for this job's entity kind. */
  protected abstract toBatch(data: T[]): ImportBatch;

  /** Ids known outside this run; override to resolve cross-entity references. */
  protected referenceScope(_context: SyncContext): ReferenceScope {
    return {};
  }

  plan(context: SyncContext): SyncResult<T> {
    const planned = this.connector.plan(this.collect(context), context);
    const validation = validateSyncPlan({
      job: this.job,
      policy: this.policy,
      payload: this.toBatch(planned.data),
      scope: this.referenceScope(context),
    });

    const { errors, warnings } = partitionSyncIssues([
      ...planned.errors,
      ...planned.warnings,
      ...validation.issues,
    ]);
    const ok = errors.length === 0;

    const stats: SyncStats = {
      ...planned.stats,
      synced: ok ? planned.stats.synced : 0,
      failed: ok ? planned.stats.failed : Math.max(planned.stats.failed, planned.data.length),
      errors: errors.length,
      warnings: warnings.length,
    };

    return {
      ok,
      status: deriveSyncStatus(stats),
      outcome: deriveSyncOutcome(stats),
      data: planned.data,
      errors,
      warnings,
      stats,
      metadata: planned.metadata,
    };
  }
}
