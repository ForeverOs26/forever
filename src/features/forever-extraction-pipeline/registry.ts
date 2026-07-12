/**
 * Forever Extraction Pipeline — the in-memory extraction registry.
 *
 * A small, deterministic lookup that lets future wiring register an
 * {@link ExtractionDefinition} under its id and resolve it later. This is the
 * open/closed seam of RC4.5 — a new extraction pipeline plugs in without any
 * existing code changing — and it mirrors the Forever Import (RC3.1), Sync
 * (RC3.2), Source Registry (RC3.3), Connectors (RC3.4), Pipeline (RC3.5),
 * Project Integration (RC4.0), Project Template (RC4.2), Project Factory
 * (RC4.3), and Project Sources (RC4.4) registries so all the foundations
 * behave identically.
 *
 * It is *not* a runtime registry: it self-populates nothing, reads no clock
 * or disk, runs no extraction, and holds no global singleton. It is a plain,
 * caller-constructed container over pure descriptors. It is deliberately not
 * a source registry either — catalogued documents stay in the RC4.4
 * {@link import("@/features/forever-project-sources").ProjectSourceRegistry};
 * this one holds only the pipelines that would read them.
 */

import type { ProjectSourceDocumentType } from "@/features/forever-project-sources";

import type { ExtractionDefinition } from "./definition";
import type { ExtractionFactType } from "./facttype";
import { distinctExtractionDocumentTypes } from "./helpers";
import type { ExtractionId } from "./types";

/** In-memory registry of extraction definitions keyed by their id. */
export class ExtractionRegistry {
  private readonly definitions = new Map<ExtractionId, ExtractionDefinition>();

  /**
   * Register a definition. Re-registering the same id throws so a clash is
   * caught at wiring time rather than silently shadowing.
   */
  register(definition: ExtractionDefinition): this {
    const id = definition.identity.id;
    if (this.definitions.has(id)) {
      throw new Error(`An extraction definition is already registered for ${id}`);
    }
    this.definitions.set(id, definition);
    return this;
  }

  /** Resolve the definition for an id, or `undefined`. */
  resolve(id: ExtractionId): ExtractionDefinition | undefined {
    return this.definitions.get(id);
  }

  /** Whether a definition is registered for an id. */
  has(id: ExtractionId): boolean {
    return this.definitions.has(id);
  }

  /** Every registered definition, in insertion order. */
  list(): ExtractionDefinition[] {
    return [...this.definitions.values()];
  }

  /** Every registered definition covering a fact type, in insertion order. */
  listByFactType(factType: ExtractionFactType): ExtractionDefinition[] {
    return this.list().filter((definition) => definition.factTypes.includes(factType));
  }

  /**
   * Every registered definition whose recipes read a given RC4.4 document
   * type, in insertion order.
   */
  listByDocumentType(documentType: ProjectSourceDocumentType): ExtractionDefinition[] {
    return this.list().filter((definition) =>
      distinctExtractionDocumentTypes(definition).includes(documentType),
    );
  }
}
