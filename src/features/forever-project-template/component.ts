/**
 * Forever Project Template — project components.
 *
 * A {@link ProjectComponent} names one part a project integration package is
 * composed of, and the foundation that supplies it. These are the generalization
 * of what the Coralina vertical slice (RC4.1) assembled by hand: an identity
 * module, source definitions, a connector, a pipeline, a canonical record, an
 * integration definition, cross-foundation reference resolution, and a
 * verification result. RC4.2 turns that ad-hoc list into a closed, ordered
 * vocabulary every future package follows.
 *
 * A component is a *descriptor*, not an implementation: it records which
 * foundation owns the part and whether the template requires it, never the part's
 * code or data. `required` is what makes "provide only verified source data,
 * follow the template for everything else" checkable — a package must provide
 * every required component, while optional components (a dedicated transport
 * connector, for instance) may legitimately be absent.
 */

import type { ProjectPackageEntityKind } from "./types";

/**
 * The closed vocabulary of parts a package is composed of.
 *
 * `identity` derives the canonical ids/slugs (RC3.0), `sources` declares the
 * verified source definitions (RC3.3), `connector` binds a transport (RC3.4),
 * `pipeline` shapes the import (RC3.5), `canonical` is the Forever Database
 * record (RC3.0), `integration` wires it all together (RC4.0), `references`
 * resolves every cross-foundation id (RC4.0 boundary), and `verification`
 * produces the deterministic readiness result (RC4.1).
 */
export type ProjectComponentKind =
  | "identity"
  | "sources"
  | "connector"
  | "pipeline"
  | "canonical"
  | "integration"
  | "references"
  | "verification";

/** Every {@link ProjectComponentKind}, in canonical (data-flow) order. */
export const PROJECT_COMPONENT_KINDS = [
  "identity",
  "sources",
  "connector",
  "pipeline",
  "canonical",
  "integration",
  "references",
  "verification",
] as const satisfies readonly ProjectComponentKind[];

/** Runtime guard: whether a value is a known {@link ProjectComponentKind}. */
export function isKnownProjectComponentKind(value: unknown): value is ProjectComponentKind {
  return (
    typeof value === "string" && (PROJECT_COMPONENT_KINDS as readonly string[]).includes(value)
  );
}

/**
 * The Forever foundation release that supplies a component.
 *
 * A closed vocabulary so a component always points at a real neighbouring
 * foundation and never a free-text label. RC4.2 itself is the seam that composes
 * them; it introduces no new runtime.
 */
export type ProjectFoundation = "rc3.0" | "rc3.3" | "rc3.4" | "rc3.5" | "rc4.0" | "rc4.1";

/** Every {@link ProjectFoundation}, in release order. */
export const PROJECT_FOUNDATIONS = [
  "rc3.0",
  "rc3.3",
  "rc3.4",
  "rc3.5",
  "rc4.0",
  "rc4.1",
] as const satisfies readonly ProjectFoundation[];

/** Runtime guard: whether a value is a known {@link ProjectFoundation}. */
export function isKnownProjectFoundation(value: unknown): value is ProjectFoundation {
  return typeof value === "string" && (PROJECT_FOUNDATIONS as readonly string[]).includes(value);
}

/** One part of a package: what it is, which foundation owns it, is it required. */
export interface ProjectComponent {
  kind: ProjectComponentKind;
  /** Human-readable label, e.g. `Source definitions`. */
  name: string;
  /** The foundation release that supplies this component. */
  foundation: ProjectFoundation;
  /** Whether the template requires a conforming package to provide this part. */
  required: boolean;
  /** Canonical entity kinds this component concerns. Reuses the RC3.1 kinds. */
  entities?: ProjectPackageEntityKind[];
  /** Free-text description of the component's responsibility. */
  description?: string;
}

/** Options accepted by {@link projectComponent}. */
export interface ProjectComponentOptions {
  entities?: ProjectPackageEntityKind[];
  description?: string;
}

/**
 * Build a {@link ProjectComponent}; optional facts are attached only when
 * supplied so an absent fact stays absent (anti-fabrication).
 */
export function projectComponent(
  kind: ProjectComponentKind,
  name: string,
  foundation: ProjectFoundation,
  required: boolean,
  options: ProjectComponentOptions = {},
): ProjectComponent {
  const component: ProjectComponent = { kind, name, foundation, required };
  if (options.entities !== undefined) component.entities = options.entities;
  if (options.description !== undefined) component.description = options.description;
  return component;
}
