/**
 * Forever Connectors — registry entry and catalogue models.
 *
 * A {@link ConnectorRegistryEntry} pairs a {@link ConnectorDefinition} with its
 * current {@link ConnectorStatus}, an optional {@link ConnectorHealth}, and
 * optional registration notes — a definition is *what* a connector is, an entry
 * is *how it currently stands* in a catalogue. A {@link ConnectorRegistry} is
 * the immutable data model of a catalogue: an id and its ordered entries.
 *
 * This is the *data* shape of a registry; the deterministic in-memory lookup
 * that resolves definitions lives in
 * {@link import("./registry").ConnectorDefinitionRegistry}. The helpers here are
 * pure and immutable — they never mutate an input, so identical inputs always
 * yield an equal result and callers can share a registry freely. RC3.4 persists
 * nothing.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { ConnectorDefinition } from "./definition";
import type { ConnectorHealth } from "./health";
import type { ConnectorStatus } from "./status";
import type { ConnectorId } from "./types";

/** One connector in a catalogue: its definition plus its current standing. */
export interface ConnectorRegistryEntry {
  definition: ConnectorDefinition;
  status: ConnectorStatus;
  /** Last observed health; omitted when never checked. */
  health?: ConnectorHealth;
  /** When the connector was registered, supplied by the caller. */
  registeredAt?: ISODateTime;
  /** Free-text notes about this registration. */
  notes?: string;
}

/** The immutable data model of a connector catalogue. */
export interface ConnectorRegistry {
  id: string;
  name?: string;
  entries: ConnectorRegistryEntry[];
}

/** An empty registry with the given id and optional name. */
export function emptyConnectorRegistry(id: string, name?: string): ConnectorRegistry {
  return name === undefined ? { id, entries: [] } : { id, name, entries: [] };
}

/**
 * Append an entry, returning a new {@link ConnectorRegistry}.
 *
 * Immutable: the input registry is never mutated.
 */
export function addConnectorEntry(
  registry: ConnectorRegistry,
  entry: ConnectorRegistryEntry,
): ConnectorRegistry {
  return { ...registry, entries: [...registry.entries, entry] };
}

/** The entry whose definition has the given connector id, or `undefined`. */
export function findConnectorEntry(
  registry: ConnectorRegistry,
  connectorId: ConnectorId,
): ConnectorRegistryEntry | undefined {
  return registry.entries.find((entry) => entry.definition.identity.id === connectorId);
}

/** Every entry in the registry with the given status, in registry order. */
export function listConnectorEntriesByStatus(
  registry: ConnectorRegistry,
  status: ConnectorStatus,
): ConnectorRegistryEntry[] {
  return registry.entries.filter((entry) => entry.status === status);
}
