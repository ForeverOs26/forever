/**
 * Forever Project Template — the in-memory package registry.
 *
 * A small, deterministic lookup that lets future wiring register a
 * {@link ProjectPackage} under its id and resolve it later. This is the
 * open/closed seam of RC4.2 — a new project package plugs in without any existing
 * code changing — and it mirrors the Forever Import (RC3.1), Sync (RC3.2), Source
 * Registry (RC3.3), Connectors (RC3.4), Pipeline (RC3.5), and Project Integration
 * (RC4.0) registries so all the foundations behave identically.
 *
 * It is *not* a runtime registry: it self-populates nothing, reads no clock or
 * disk, runs no stage, and holds no global singleton. It is a plain,
 * caller-constructed container over pure descriptors.
 */

import type { ProjectComponentKind } from "./component";
import { projectPackageProvidesComponent, type ProjectPackage } from "./package";
import type { ProjectPackageScope, ProjectPackageId, ProjectTemplateId } from "./types";

/** In-memory registry of project packages keyed by their id. */
export class ProjectPackageRegistry {
  private readonly packages = new Map<ProjectPackageId, ProjectPackage>();

  /**
   * Register a package. Re-registering the same id throws so a clash is caught at
   * wiring time rather than silently shadowing.
   */
  register(pkg: ProjectPackage): this {
    const id = pkg.identity.id;
    if (this.packages.has(id)) {
      throw new Error(`A project package is already registered for ${id}`);
    }
    this.packages.set(id, pkg);
    return this;
  }

  /** Resolve the package for an id, or `undefined`. */
  resolve(id: ProjectPackageId): ProjectPackage | undefined {
    return this.packages.get(id);
  }

  /** Whether a package is registered for an id. */
  has(id: ProjectPackageId): boolean {
    return this.packages.has(id);
  }

  /** Every registered package, in insertion order. */
  list(): ProjectPackage[] {
    return [...this.packages.values()];
  }

  /** Every registered package of a given scope, in insertion order. */
  listByScope(scope: ProjectPackageScope): ProjectPackage[] {
    return this.list().filter((pkg) => pkg.identity.scope === scope);
  }

  /** Every registered package that conforms to a given template, in insertion order. */
  listByTemplate(templateId: ProjectTemplateId): ProjectPackage[] {
    return this.list().filter((pkg) => pkg.templateId === templateId);
  }

  /** Every registered package that provides a given component kind, in order. */
  listByComponent(kind: ProjectComponentKind): ProjectPackage[] {
    return this.list().filter((pkg) => projectPackageProvidesComponent(pkg, kind));
  }
}
