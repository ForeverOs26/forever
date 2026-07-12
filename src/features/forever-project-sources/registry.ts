/**
 * Forever Project Sources — the in-memory source registry.
 *
 * A small, deterministic lookup that lets future wiring register a
 * {@link ProjectSourceDefinition} under its id and resolve it later. This is
 * the open/closed seam of RC4.4 — a newly received document plugs in without
 * any existing code changing — and it mirrors the Forever Import (RC3.1), Sync
 * (RC3.2), Source Registry (RC3.3), Connectors (RC3.4), Pipeline (RC3.5),
 * Project Integration (RC4.0), Project Template (RC4.2), and Project Factory
 * (RC4.3) registries so all the foundations behave identically.
 *
 * It is *not* a runtime registry: it self-populates nothing, reads no clock or
 * disk, runs no import, and holds no global singleton. It is a plain,
 * caller-constructed container over pure descriptors. Multiple received
 * revisions of the same document register side by side under their
 * version-addressed ids; the document-key lookups order and resolve them
 * without any storage.
 */

import type { ProjectSourceDefinition } from "./definition";
import type { ProjectSourceDocumentType } from "./descriptor";
import { projectSourceDocumentKey, sortProjectSourcesByVersion } from "./helpers";
import type { ProjectSourceStatus } from "./status";
import type { ProjectSourceId } from "./types";

/** In-memory registry of project-source definitions keyed by their id. */
export class ProjectSourceRegistry {
  private readonly definitions = new Map<ProjectSourceId, ProjectSourceDefinition>();

  /**
   * Register a source. Re-registering the same id throws so a clash is caught
   * at wiring time rather than silently shadowing.
   */
  register(definition: ProjectSourceDefinition): this {
    const id = definition.identity.id;
    if (this.definitions.has(id)) {
      throw new Error(`A project source is already registered for ${id}`);
    }
    this.definitions.set(id, definition);
    return this;
  }

  /** Resolve the source for an id, or `undefined`. */
  resolve(id: ProjectSourceId): ProjectSourceDefinition | undefined {
    return this.definitions.get(id);
  }

  /** Whether a source is registered for an id. */
  has(id: ProjectSourceId): boolean {
    return this.definitions.has(id);
  }

  /** Every registered source, in insertion order. */
  list(): ProjectSourceDefinition[] {
    return [...this.definitions.values()];
  }

  /** Every registered source of a project, in insertion order. */
  listByProject(projectId: string): ProjectSourceDefinition[] {
    return this.list().filter((definition) => definition.identity.projectId === projectId);
  }

  /** Every registered source of a document type, in insertion order. */
  listByDocumentType(documentType: ProjectSourceDocumentType): ProjectSourceDefinition[] {
    return this.list().filter((definition) => definition.descriptor.documentType === documentType);
  }

  /** Every registered source in a given standing, in insertion order. */
  listByStatus(status: ProjectSourceStatus): ProjectSourceDefinition[] {
    return this.list().filter((definition) => definition.status === status);
  }

  /**
   * Every registered revision of one document — the sources sharing a
   * `projectId:slug` document key — ordered oldest revision first.
   */
  versionsOf(documentKey: string): ProjectSourceDefinition[] {
    return sortProjectSourcesByVersion(
      this.list().filter(
        (definition) => projectSourceDocumentKey(definition.identity) === documentKey,
      ),
    );
  }

  /**
   * The highest registered revision of one document, or `undefined`. Equal
   * revisions resolve to the later registration (the ordering is stable).
   */
  latestVersionOf(documentKey: string): ProjectSourceDefinition | undefined {
    const versions = this.versionsOf(documentKey);
    return versions.length > 0 ? versions[versions.length - 1] : undefined;
  }
}
