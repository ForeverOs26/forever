/**
 * Forever Sync — connector registry.
 *
 * A small, deterministic lookup that lets future synchronizers register a
 * {@link SyncConnector} for a `(system, entityKind, direction)` triple and
 * resolve it later. This is how a new system plugs into the foundation without
 * any existing code changing — the open/closed seam of RC3.2, mirroring the
 * Forever Import (RC3.1) adapter registry.
 */

import type { SyncConnector } from "./contracts";
import type { SyncDirection, SyncEntityKind, SyncSystem } from "./types";

function keyOf(system: SyncSystem, entityKind: SyncEntityKind, direction: SyncDirection): string {
  return `${system}:${entityKind}:${direction}`;
}

/** In-memory registry of connectors keyed by `(system, entityKind, direction)`. */
export class SyncConnectorRegistry {
  private readonly connectors = new Map<string, SyncConnector<unknown>>();

  /**
   * Register a connector. Re-registering the same triple throws so a clash is
   * caught at wiring time rather than silently shadowing.
   */
  register<T>(connector: SyncConnector<T>): this {
    const key = keyOf(connector.system, connector.entityKind, connector.direction);
    if (this.connectors.has(key)) {
      throw new Error(`A sync connector is already registered for ${key}`);
    }
    this.connectors.set(key, connector as SyncConnector<unknown>);
    return this;
  }

  /** Resolve the connector for a triple, or `undefined`. */
  resolve(
    system: SyncSystem,
    entityKind: SyncEntityKind,
    direction: SyncDirection,
  ): SyncConnector<unknown> | undefined {
    return this.connectors.get(keyOf(system, entityKind, direction));
  }

  /** Whether a connector is registered for a triple. */
  has(system: SyncSystem, entityKind: SyncEntityKind, direction: SyncDirection): boolean {
    return this.connectors.has(keyOf(system, entityKind, direction));
  }

  /** Every registered connector, in insertion order. */
  list(): SyncConnector<unknown>[] {
    return [...this.connectors.values()];
  }
}
