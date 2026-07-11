/**
 * Forever Connectors — the in-memory connector registry.
 *
 * A small, deterministic lookup that lets future wiring register a
 * {@link ConnectorDefinition} under its id and resolve it later. This is the
 * open/closed seam of RC3.4 — a new connector plugs in without any existing code
 * changing — and it mirrors the Forever Import (RC3.1) adapter registry, the
 * Forever Sync (RC3.2) connector registry, and the Forever Source Registry
 * (RC3.3) definition registry so all four foundations behave identically.
 *
 * It is *not* a runtime registry: it self-populates nothing, reads no clock or
 * disk, opens no connection, and holds no global singleton. It is a plain,
 * caller-constructed container over pure descriptors.
 */

import type { SyncProtocol, SyncSystem } from "@/features/forever-sync";

import type { ConnectorDefinition } from "./definition";
import type { ConnectorId } from "./types";

/** In-memory registry of connector definitions keyed by their id. */
export class ConnectorDefinitionRegistry {
  private readonly definitions = new Map<ConnectorId, ConnectorDefinition>();

  /**
   * Register a definition. Re-registering the same id throws so a clash is
   * caught at wiring time rather than silently shadowing.
   */
  register(definition: ConnectorDefinition): this {
    const id = definition.identity.id;
    if (this.definitions.has(id)) {
      throw new Error(`A connector is already registered for ${id}`);
    }
    this.definitions.set(id, definition);
    return this;
  }

  /** Resolve the definition for an id, or `undefined`. */
  resolve(id: ConnectorId): ConnectorDefinition | undefined {
    return this.definitions.get(id);
  }

  /** Whether a definition is registered for an id. */
  has(id: ConnectorId): boolean {
    return this.definitions.has(id);
  }

  /** Every registered definition, in insertion order. */
  list(): ConnectorDefinition[] {
    return [...this.definitions.values()];
  }

  /** Every registered definition bound to a given system, in insertion order. */
  listBySystem(system: SyncSystem): ConnectorDefinition[] {
    return this.list().filter((definition) => definition.identity.targetSystem === system);
  }

  /** Every registered definition speaking a given protocol, in insertion order. */
  listByProtocol(protocol: SyncProtocol): ConnectorDefinition[] {
    return this.list().filter((definition) => definition.identity.protocol === protocol);
  }
}
