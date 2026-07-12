/**
 * Forever Project Template — the cross-foundation reference contract.
 *
 * A {@link ProjectReference} declares one reference a conforming package must be
 * able to resolve: an integration pointing at its sources, a pipeline pointing at
 * its sources, a unit pointing at its project, and so on. This is the
 * generalization of the concrete checks the Coralina slice performed in
 * `resolveCoralinaReferences` — lifted out of that one project into a reusable
 * *contract* that says which references any package must resolve, and which are
 * only expected when the optional data is present.
 *
 * RC4.2 defines the contract, not a resolver. It resolves nothing against a live
 * registry or record — closing a concrete reference against real data stays a
 * per-project concern (as RC4.1 did) or a future runtime's. Encoding some
 * references as `required: false` is deliberate anti-fabrication: a project may
 * legitimately have no verified developer, documents, or media, so those
 * references are only expected when the fact exists — never invented to satisfy
 * the contract.
 */

import type { ProjectComponentKind } from "./component";

/**
 * The closed vocabulary of cross-foundation references a package can make.
 *
 * The `*-source`/`*-connector`/`*-pipeline` kinds are id references between the
 * RC3.3/3.4/3.5/4.0 descriptors; the `project-*`, `unit-*`, `document-*`, and
 * `media-*` kinds are canonical foreign keys inside the RC3.0 record;
 * `canonical-integrity` is the authoritative whole-record RC3.0 check.
 */
export type ProjectReferenceKind =
  | "integration-source"
  | "integration-connector"
  | "integration-pipeline"
  | "connector-source"
  | "pipeline-source"
  | "pipeline-connector"
  | "project-developer"
  | "project-location"
  | "unit-project"
  | "document-project"
  | "media-project"
  | "canonical-integrity";

/** Every {@link ProjectReferenceKind}, in a stable declared order. */
export const PROJECT_REFERENCE_KINDS = [
  "integration-source",
  "integration-connector",
  "integration-pipeline",
  "connector-source",
  "pipeline-source",
  "pipeline-connector",
  "project-developer",
  "project-location",
  "unit-project",
  "document-project",
  "media-project",
  "canonical-integrity",
] as const satisfies readonly ProjectReferenceKind[];

/** Runtime guard: whether a value is a known {@link ProjectReferenceKind}. */
export function isKnownProjectReferenceKind(value: unknown): value is ProjectReferenceKind {
  return (
    typeof value === "string" && (PROJECT_REFERENCE_KINDS as readonly string[]).includes(value)
  );
}

/** One declared reference a package must (or, when optional, may) resolve. */
export interface ProjectReference {
  kind: ProjectReferenceKind;
  /** The component the reference is made from. */
  from: ProjectComponentKind;
  /** The component the reference points at. */
  to: ProjectComponentKind;
  /**
   * Whether every conforming package must resolve this reference. `false` marks a
   * reference expected only when its optional data is present (e.g. a developer),
   * so absent facts stay absent rather than being fabricated to satisfy it.
   */
  required: boolean;
  /** Free-text description of what the reference asserts. */
  description?: string;
}

/** Options accepted by {@link projectReference}. */
export interface ProjectReferenceOptions {
  description?: string;
}

/** Build a {@link ProjectReference}; the description is attached only when supplied. */
export function projectReference(
  kind: ProjectReferenceKind,
  from: ProjectComponentKind,
  to: ProjectComponentKind,
  required: boolean,
  options: ProjectReferenceOptions = {},
): ProjectReference {
  const reference: ProjectReference = { kind, from, to, required };
  if (options.description !== undefined) reference.description = options.description;
  return reference;
}

/** The required references in a set, in declared order. */
export function requiredProjectReferences(
  references: readonly ProjectReference[],
): ProjectReference[] {
  return references.filter((reference) => reference.required);
}

/** The references made *from* a given component, in declared order. */
export function projectReferencesFrom(
  references: readonly ProjectReference[],
  from: ProjectComponentKind,
): ProjectReference[] {
  return references.filter((reference) => reference.from === from);
}
