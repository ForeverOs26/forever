/**
 * Forever Project Template — deterministic, immutable helpers.
 *
 * Pure, side-effect-free utilities shared across the foundation: stable natural
 * keys for templates and packages, component and reference collectors, and a
 * template-conformance summary. Given the same input they always return the same
 * output — no randomness, no clocks, no locale — so the whole module stays
 * deterministic and these helpers never need re-implementing per call site.
 *
 * The string guard is reused verbatim from the Forever Project Integration
 * (RC4.0) helpers rather than restated, so RC4.2 shares one definition of
 * "non-empty string" with the validation machinery it also reuses.
 */

import { isNonEmptyString } from "@/features/forever-project-integration";

import type { ProjectComponent, ProjectComponentKind } from "./component";
import type { ProjectPackageIdentity, ProjectTemplateIdentity } from "./identity";
import type { ProjectPackage } from "./package";
import type { ProjectReference } from "./reference";
import type { ProjectTemplate } from "./template";

export { isNonEmptyString };

/**
 * Stable key for a package identity, independent of its surrogate id:
 * `scope:slug`. Two package identities of the same scope under the same slug
 * share a key.
 */
export function projectPackageIdentityKey(identity: ProjectPackageIdentity): string {
  return `${identity.scope}:${identity.slug}`;
}

/** Stable natural key for a package, derived from its identity. */
export function projectPackageKey(pkg: ProjectPackage): string {
  return projectPackageIdentityKey(pkg.identity);
}

/** Stable natural key for a template, derived from its identity slug. */
export function projectTemplateKey(identity: ProjectTemplateIdentity): string {
  return identity.slug;
}

/** The number of components a template defines. */
export function projectComponentCount(template: ProjectTemplate): number {
  return template.components.length;
}

/** The required components of a template, in declared order. */
export function requiredProjectComponents(template: ProjectTemplate): ProjectComponent[] {
  return template.components.filter((component) => component.required);
}

/** The distinct component kinds a template defines, in declared order. */
export function projectComponentKinds(template: ProjectTemplate): ProjectComponentKind[] {
  const seen = new Set<ProjectComponentKind>();
  const kinds: ProjectComponentKind[] = [];
  for (const component of template.components) {
    if (!seen.has(component.kind)) {
      seen.add(component.kind);
      kinds.push(component.kind);
    }
  }
  return kinds;
}

/** The component of a template with a given kind, or `undefined`. */
export function findProjectComponent(
  template: ProjectTemplate,
  kind: ProjectComponentKind,
): ProjectComponent | undefined {
  return template.components.find((component) => component.kind === kind);
}

/** The distinct components referenced by a reference set, in first-seen order. */
export function projectReferencedComponents(
  references: readonly ProjectReference[],
): ProjectComponentKind[] {
  const seen = new Set<ProjectComponentKind>();
  const kinds: ProjectComponentKind[] = [];
  for (const reference of references) {
    for (const kind of [reference.from, reference.to]) {
      if (!seen.has(kind)) {
        seen.add(kind);
        kinds.push(kind);
      }
    }
  }
  return kinds;
}

/** A deterministic summary of how a package's declared components meet a template. */
export interface ProjectConformanceSummary {
  /** Required component kinds the package provides. */
  satisfied: ProjectComponentKind[];
  /** Required component kinds the package is missing. */
  missing: ProjectComponentKind[];
  /** Provided component kinds the template does not define. */
  extra: ProjectComponentKind[];
}

/**
 * Summarize a package's declared components against a template.
 *
 * Pure and total: partitions the required kinds into satisfied vs. missing and
 * lists any provided kinds the template does not define, all in template/declared
 * order. It reads both inputs and mutates neither.
 */
export function summarizeProjectConformance(
  template: ProjectTemplate,
  pkg: ProjectPackage,
): ProjectConformanceSummary {
  const provided = new Set(pkg.provides);
  const defined = new Set(template.components.map((component) => component.kind));

  const satisfied: ProjectComponentKind[] = [];
  const missing: ProjectComponentKind[] = [];
  for (const component of requiredProjectComponents(template)) {
    if (provided.has(component.kind)) satisfied.push(component.kind);
    else missing.push(component.kind);
  }

  const extra = pkg.provides.filter((kind) => !defined.has(kind));
  return { satisfied, missing, extra };
}
