/**
 * Forever Project Template — the assembled project bundle.
 *
 * A {@link ProjectBundle} pairs a {@link ProjectPackage} with the
 * {@link ProjectTemplate} it conforms to and resolves the two against each other:
 * for every component the template defines it records whether the package
 * provides it, and it carries forward the reference contract and the effective
 * layout. It is the generalization of the concrete `CoralinaIntegrationBundle` —
 * lifted from "one project's populated registries" to "any package measured
 * against the canonical template".
 *
 * The bundle is a pure, deterministic value: {@link buildProjectBundle} reads no
 * clock and shares no state, so every call returns an equal, independent bundle.
 * It resolves *structure* (which components a package declares), never data — it
 * never builds a registry, opens a connection, or runs a step.
 */

import type { ProjectComponent, ProjectComponentKind } from "./component";
import type { ProjectLayout } from "./layout";
import type { ProjectPackage } from "./package";
import { projectPackageProvidesComponent } from "./package";
import type { ProjectReference } from "./reference";
import { buildForeverProjectTemplate, type ProjectTemplate } from "./template";

/** One template component paired with whether the bundle's package provides it. */
export interface ProjectBundleComponent {
  component: ProjectComponent;
  /** Whether the package declares it provides this component. */
  provided: boolean;
}

/** A package assembled against the template it conforms to. */
export interface ProjectBundle {
  template: ProjectTemplate;
  package: ProjectPackage;
  /** Every template component, marked with whether the package provides it. */
  components: ProjectBundleComponent[];
  /** The cross-foundation reference contract the package must resolve. */
  references: ProjectReference[];
  /** The effective layout: the package's override, or the template's. */
  layout: ProjectLayout;
}

/**
 * Assemble a {@link ProjectBundle} from a package and the template it conforms to.
 *
 * Deterministic and non-mutating: it reads both inputs and returns a fresh bundle,
 * defaulting to the canonical template. A package layout override wins over the
 * template's; otherwise the template layout is used.
 */
export function buildProjectBundle(
  pkg: ProjectPackage,
  template: ProjectTemplate = buildForeverProjectTemplate(),
): ProjectBundle {
  const components: ProjectBundleComponent[] = template.components.map((component) => ({
    component,
    provided: projectPackageProvidesComponent(pkg, component.kind),
  }));
  return {
    template,
    package: pkg,
    components,
    references: template.references,
    layout: pkg.layout ?? template.layout,
  };
}

/** The template component kinds a bundle's package is missing but should provide. */
export function missingProjectComponentKinds(bundle: ProjectBundle): ProjectComponentKind[] {
  return bundle.components
    .filter((entry) => entry.component.required && !entry.provided)
    .map((entry) => entry.component.kind);
}

/** The template component kinds a bundle's package provides, in template order. */
export function providedProjectComponentKinds(bundle: ProjectBundle): ProjectComponentKind[] {
  return bundle.components
    .filter((entry) => entry.provided)
    .map((entry) => entry.component.kind);
}

/** Whether the package provides every component the template requires. */
export function isProjectBundleComplete(bundle: ProjectBundle): boolean {
  return missingProjectComponentKinds(bundle).length === 0;
}
