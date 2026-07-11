/**
 * Forever Source Registry — the in-memory source registry.
 *
 * A small, deterministic lookup that lets future wiring register a
 * {@link SourceDefinition} under its id and resolve it later. This is the
 * open/closed seam of RC3.3 — a new source plugs in without any existing code
 * changing — and it mirrors the Forever Import (RC3.1) adapter registry and the
 * Forever Sync (RC3.2) connector registry so all three foundations behave
 * identically.
 *
 * It is *not* a runtime registry: it self-populates nothing, reads no clock or
 * disk, opens no connection, and holds no global singleton. It is a plain,
 * caller-constructed container over pure descriptors.
 */

import type { SourceDefinition } from "./definition";
import type { SourceType } from "./enums";
import type { SourceId } from "./types";

/** In-memory registry of source definitions keyed by their id. */
export class SourceDefinitionRegistry {
  private readonly definitions = new Map<SourceId, SourceDefinition>();

  /**
   * Register a definition. Re-registering the same id throws so a clash is
   * caught at wiring time rather than silently shadowing.
   */
  register(definition: SourceDefinition): this {
    const id = definition.identity.id;
    if (this.definitions.has(id)) {
      throw new Error(`A source is already registered for ${id}`);
    }
    this.definitions.set(id, definition);
    return this;
  }

  /** Resolve the definition for an id, or `undefined`. */
  resolve(id: SourceId): SourceDefinition | undefined {
    return this.definitions.get(id);
  }

  /** Whether a definition is registered for an id. */
  has(id: SourceId): boolean {
    return this.definitions.has(id);
  }

  /** Every registered definition, in insertion order. */
  list(): SourceDefinition[] {
    return [...this.definitions.values()];
  }

  /** Every registered definition of a given type, in insertion order. */
  listByType(type: SourceType): SourceDefinition[] {
    return this.list().filter((definition) => definition.identity.type === type);
  }
}
