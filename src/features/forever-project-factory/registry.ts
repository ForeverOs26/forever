/**
 * Forever Project Factory — the in-memory factory registry.
 *
 * A small, deterministic lookup that lets future wiring register a
 * {@link FactoryDefinition} under its id and resolve it later. This is the
 * open/closed seam of RC4.3 — a new factory plugs in without any existing code
 * changing — and it mirrors the Forever Import (RC3.1), Sync (RC3.2), Source
 * Registry (RC3.3), Connectors (RC3.4), Pipeline (RC3.5), Project Integration
 * (RC4.0), and Project Template (RC4.2) registries so all the foundations
 * behave identically.
 *
 * It is *not* a runtime registry: it self-populates nothing, reads no clock or
 * disk, runs no stage, and holds no global singleton. It is a plain,
 * caller-constructed container over pure descriptors.
 */

import type { ProjectTemplateId } from "@/features/forever-project-template";

import type { FactoryDefinition } from "./definition";
import { factoryTemplateIds } from "./helpers";
import type { FactoryEntityKind, FactoryId, FactoryScope } from "./types";

/** In-memory registry of factory definitions keyed by their id. */
export class FactoryRegistry {
  private readonly definitions = new Map<FactoryId, FactoryDefinition>();

  /**
   * Register a factory. Re-registering the same id throws so a clash is caught
   * at wiring time rather than silently shadowing.
   */
  register(definition: FactoryDefinition): this {
    const id = definition.identity.id;
    if (this.definitions.has(id)) {
      throw new Error(`A factory is already registered for ${id}`);
    }
    this.definitions.set(id, definition);
    return this;
  }

  /** Resolve the factory for an id, or `undefined`. */
  resolve(id: FactoryId): FactoryDefinition | undefined {
    return this.definitions.get(id);
  }

  /** Whether a factory is registered for an id. */
  has(id: FactoryId): boolean {
    return this.definitions.has(id);
  }

  /** Every registered factory, in insertion order. */
  list(): FactoryDefinition[] {
    return [...this.definitions.values()];
  }

  /** Every registered factory of a given scope, in insertion order. */
  listByScope(scope: FactoryScope): FactoryDefinition[] {
    return this.list().filter((definition) => definition.identity.scope === scope);
  }

  /** Every registered factory whose outputs cover a given entity kind, in order. */
  listByEntity(kind: FactoryEntityKind): FactoryDefinition[] {
    return this.list().filter((definition) => definition.entities.includes(kind));
  }

  /** Every registered factory generating from a given RC4.2 template, in order. */
  listByTemplate(templateId: ProjectTemplateId): FactoryDefinition[] {
    return this.list().filter((definition) => factoryTemplateIds(definition).includes(templateId));
  }
}
