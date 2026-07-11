/**
 * Forever Sync — the connector contract.
 *
 * A {@link SyncConnector} is the seam between an external system and canonical
 * Forever records. RC3.2 defines the contract only; later releases implement it
 * for Website, CRM, Forever Database, Marketplace, AI Agents, Manual, and future
 * API providers.
 *
 * Connectors are pure and deterministic: they receive records that have
 * *already* been materialized (fetched, read, decoded elsewhere) and produce a
 * plan describing what a sync *would* do. Transport — HTTP, webhooks, file IO,
 * authentication, and any write — lives entirely outside this contract, so a
 * connector is trivially unit-testable and never touches the network.
 */

import type { SyncContext, SyncDirection, SyncEntityKind, SyncResult, SyncSystem } from "../types";

/**
 * Already-materialized input handed to a connector for planning.
 *
 * Intentionally `unknown`: each concrete connector narrows it to the shape its
 * system produces. The foundation makes no assumption about it and never
 * dereferences a network resource to obtain it.
 */
export type RawSyncPayload = unknown;

/**
 * Plans synchronization of one {@link SyncEntityKind} for one {@link SyncSystem}.
 *
 * @typeParam T - the canonical Forever entity the connector moves.
 */
export interface SyncConnector<T> {
  /** The system this connector talks to. */
  readonly system: SyncSystem;
  /** The canonical entity kind this connector moves. */
  readonly entityKind: SyncEntityKind;
  /** The direction of flow this connector supports. */
  readonly direction: SyncDirection;
  /**
   * Produce a {@link SyncResult} describing the intended synchronization of the
   * given records. Must be pure: no IO, no clock, no randomness, and no write —
   * identical `(records, context)` yields identical output.
   */
  plan(records: readonly T[], context: SyncContext): SyncResult<T>;
}

/**
 * Identity helper that pins an object to the {@link SyncConnector} contract.
 *
 * Gives implementations full type-checking and inference without forcing a
 * class; the returned value is the connector unchanged.
 */
export function defineSyncConnector<T>(connector: SyncConnector<T>): SyncConnector<T> {
  return connector;
}
