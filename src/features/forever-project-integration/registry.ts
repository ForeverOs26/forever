/**
 * Forever Project Integration — the in-memory integration registry.
 *
 * A small, deterministic lookup that lets future wiring register a
 * {@link ProjectIntegrationDefinition} under its id and resolve it later. This is
 * the open/closed seam of RC4.0 — a new integration plugs in without any existing
 * code changing — and it mirrors the Forever Import (RC3.1) adapter registry, the
 * Forever Sync (RC3.2) connector registry, the Forever Source Registry (RC3.3)
 * definition registry, the Forever Connectors (RC3.4) registry, and the Forever
 * Pipeline (RC3.5) definition registry so all the foundations behave identically.
 *
 * It is *not* a runtime registry: it self-populates nothing, reads no clock or
 * disk, runs no stage, and holds no global singleton. It is a plain,
 * caller-constructed container over pure descriptors.
 */

import type { ProjectIntegrationDefinition } from "./definition";
import type { ProjectIntegrationScope } from "./identity";
import type { ProjectIntegrationEntityKind, ProjectIntegrationId } from "./types";

/** In-memory registry of integration definitions keyed by their id. */
export class ProjectIntegrationDefinitionRegistry {
  private readonly definitions = new Map<
    ProjectIntegrationId,
    ProjectIntegrationDefinition
  >();

  /**
   * Register a definition. Re-registering the same id throws so a clash is caught
   * at wiring time rather than silently shadowing.
   */
  register(definition: ProjectIntegrationDefinition): this {
    const id = definition.identity.id;
    if (this.definitions.has(id)) {
      throw new Error(`An integration is already registered for ${id}`);
    }
    this.definitions.set(id, definition);
    return this;
  }

  /** Resolve the definition for an id, or `undefined`. */
  resolve(id: ProjectIntegrationId): ProjectIntegrationDefinition | undefined {
    return this.definitions.get(id);
  }

  /** Whether a definition is registered for an id. */
  has(id: ProjectIntegrationId): boolean {
    return this.definitions.has(id);
  }

  /** Every registered definition, in insertion order. */
  list(): ProjectIntegrationDefinition[] {
    return [...this.definitions.values()];
  }

  /** Every registered definition of a given scope, in insertion order. */
  listByScope(scope: ProjectIntegrationScope): ProjectIntegrationDefinition[] {
    return this.list().filter((definition) => definition.identity.scope === scope);
  }

  /** Every registered definition that handles a given entity kind, in order. */
  listByEntity(kind: ProjectIntegrationEntityKind): ProjectIntegrationDefinition[] {
    return this.list().filter((definition) => definition.entities.includes(kind));
  }
}
