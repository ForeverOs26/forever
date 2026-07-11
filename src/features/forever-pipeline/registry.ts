/**
 * Forever Pipeline — the in-memory pipeline registry.
 *
 * A small, deterministic lookup that lets future wiring register a
 * {@link PipelineDefinition} under its id and resolve it later. This is the
 * open/closed seam of RC3.5 — a new pipeline plugs in without any existing code
 * changing — and it mirrors the Forever Import (RC3.1) adapter registry, the
 * Forever Sync (RC3.2) connector registry, the Forever Source Registry (RC3.3)
 * definition registry, and the Forever Connectors (RC3.4) registry so all five
 * foundations behave identically.
 *
 * It is *not* a runtime registry: it self-populates nothing, reads no clock or
 * disk, runs no stage, and holds no global singleton. It is a plain,
 * caller-constructed container over pure descriptors.
 */

import type { PipelineDefinition } from "./definition";
import type { PipelineMode } from "./identity";
import type { PipelineEntityKind, PipelineId } from "./types";

/** In-memory registry of pipeline definitions keyed by their id. */
export class PipelineDefinitionRegistry {
  private readonly definitions = new Map<PipelineId, PipelineDefinition>();

  /**
   * Register a definition. Re-registering the same id throws so a clash is
   * caught at wiring time rather than silently shadowing.
   */
  register(definition: PipelineDefinition): this {
    const id = definition.identity.id;
    if (this.definitions.has(id)) {
      throw new Error(`A pipeline is already registered for ${id}`);
    }
    this.definitions.set(id, definition);
    return this;
  }

  /** Resolve the definition for an id, or `undefined`. */
  resolve(id: PipelineId): PipelineDefinition | undefined {
    return this.definitions.get(id);
  }

  /** Whether a definition is registered for an id. */
  has(id: PipelineId): boolean {
    return this.definitions.has(id);
  }

  /** Every registered definition, in insertion order. */
  list(): PipelineDefinition[] {
    return [...this.definitions.values()];
  }

  /** Every registered definition of a given mode, in insertion order. */
  listByMode(mode: PipelineMode): PipelineDefinition[] {
    return this.list().filter((definition) => definition.identity.mode === mode);
  }

  /** Every registered definition that handles a given entity kind, in order. */
  listByEntity(kind: PipelineEntityKind): PipelineDefinition[] {
    return this.list().filter((definition) => definition.entities.includes(kind));
  }
}
