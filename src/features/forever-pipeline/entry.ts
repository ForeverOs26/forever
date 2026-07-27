/**
 * Forever Pipeline — registry entry and catalogue models.
 *
 * A {@link PipelineRegistryEntry} pairs a {@link PipelineDefinition} with whether
 * it is currently enabled and optional registration notes — a definition is
 * *what* a pipeline is, an entry is *how it currently stands* in a catalogue. A
 * {@link PipelineRegistry} is the immutable data model of a catalogue: an id and
 * its ordered entries.
 *
 * This is the *data* shape of a registry; the deterministic in-memory lookup
 * that resolves definitions lives in
 * {@link import("./registry").PipelineDefinitionRegistry}. The helpers here are
 * pure and immutable — they never mutate an input, so identical inputs always
 * yield an equal result and callers can share a registry freely. RC3.5 persists
 * nothing.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { PipelineDefinition } from "./definition";
import type { PipelineId } from "./types";

/** One pipeline in a catalogue: its definition plus its current standing. */
export interface PipelineRegistryEntry {
  definition: PipelineDefinition;
  /** Whether the pipeline is switched on in this catalogue. */
  enabled: boolean;
  /** When the pipeline was registered, supplied by the caller. */
  registeredAt?: ISODateTime;
  /** Free-text notes about this registration. */
  notes?: string;
}

/** The immutable data model of a pipeline catalogue. */
export interface PipelineRegistry {
  id: string;
  name?: string;
  entries: PipelineRegistryEntry[];
}

/** An empty registry with the given id and optional name. */
export function emptyPipelineRegistry(id: string, name?: string): PipelineRegistry {
  return name === undefined ? { id, entries: [] } : { id, name, entries: [] };
}

/**
 * Append an entry, returning a new {@link PipelineRegistry}.
 *
 * Immutable: the input registry is never mutated.
 */
export function addPipelineEntry(
  registry: PipelineRegistry,
  entry: PipelineRegistryEntry,
): PipelineRegistry {
  return { ...registry, entries: [...registry.entries, entry] };
}

/** The entry whose definition has the given pipeline id, or `undefined`. */
export function findPipelineEntry(
  registry: PipelineRegistry,
  pipelineId: PipelineId,
): PipelineRegistryEntry | undefined {
  return registry.entries.find((entry) => entry.definition.identity.id === pipelineId);
}

/** Every enabled entry in the registry, in registry order. */
export function listEnabledPipelineEntries(
  registry: PipelineRegistry,
): PipelineRegistryEntry[] {
  return registry.entries.filter((entry) => entry.enabled);
}
