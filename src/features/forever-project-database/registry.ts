/**
 * Forever Canonical Project Database — the in-memory project registry.
 *
 * A small, deterministic lookup that lets future wiring register a
 * {@link ProjectRecord} under its canonical project id and resolve it later.
 * Keying by project id is what enforces the foundation's core rule at the
 * seam: every project has exactly one canonical database object — a second
 * registration for the same project clashes at wiring time instead of
 * silently shadowing. This is the open/closed seam of RC4.6 — a new project
 * plugs in without any existing code changing — and it mirrors the Forever
 * Import (RC3.1), Sync (RC3.2), Source Registry (RC3.3), Connectors (RC3.4),
 * Pipeline (RC3.5), Project Integration (RC4.0), Project Template (RC4.2),
 * Project Factory (RC4.3), Project Sources (RC4.4), and Extraction Pipeline
 * (RC4.5) registries so all the foundations behave identically.
 *
 * It is *not* a runtime store: it self-populates nothing, reads no clock or
 * disk, persists nothing, and holds no global singleton. It is a plain,
 * caller-constructed container over pure descriptors. It is deliberately not
 * a source or extraction registry either — catalogued documents stay in the
 * RC4.4 registry and pipelines in the RC4.5 one; this one holds only the
 * canonical records they feed.
 */

import type { ProjectRecord } from "./record";
import type { ProjectSectionKey } from "./section";
import type { ProjectRecordStatus } from "./status";
import type { ProjectSourceRef } from "./types";
import { distinctProjectSourceRefs } from "./helpers";

/** In-memory registry of canonical records keyed by their `proj_` id. */
export class ProjectRegistry {
  private readonly records = new Map<string, ProjectRecord>();

  /**
   * Register a record under its canonical project id. Re-registering the same
   * project throws so a second canonical object for one project is caught at
   * wiring time rather than silently shadowing — every project has exactly
   * one.
   */
  register(record: ProjectRecord): this {
    const projectId = record.identity.projectId;
    if (this.records.has(projectId)) {
      throw new Error(`A canonical record is already registered for ${projectId}`);
    }
    this.records.set(projectId, record);
    return this;
  }

  /** Resolve the canonical record for a project id, or `undefined`. */
  resolve(projectId: string): ProjectRecord | undefined {
    return this.records.get(projectId);
  }

  /** Whether a canonical record is registered for a project id. */
  has(projectId: string): boolean {
    return this.records.has(projectId);
  }

  /** Every registered record, in insertion order. */
  list(): ProjectRecord[] {
    return [...this.records.values()];
  }

  /** Every registered record with a given standing, in insertion order. */
  listByStatus(status: ProjectRecordStatus): ProjectRecord[] {
    return this.list().filter((record) => record.status === status);
  }

  /** Every registered record with a field under a section, in insertion order. */
  listBySection(section: ProjectSectionKey): ProjectRecord[] {
    return this.list().filter((record) => record.fields.some((field) => field.section === section));
  }

  /** Every registered record tracing to an RC4.4 source, in insertion order. */
  listBySource(sourceId: ProjectSourceRef): ProjectRecord[] {
    return this.list().filter((record) => distinctProjectSourceRefs(record).includes(sourceId));
  }
}
