/**
 * Forever Project Integration — integration identity.
 *
 * A {@link ProjectIntegrationIdentity} is the stable, human- and
 * machine-addressable name of an integration: its id, its URL-safe slug, a
 * display name, and the {@link ProjectIntegrationScope} that classifies what the
 * integration spans. It reuses the RC3.0 `Slug` and id types so an integration is
 * addressed the same way every other canonical Forever entity is — never a
 * parallel scheme.
 *
 * Identity carries no behaviour and no connection detail — the stages, steps,
 * and policy live on the {@link import("./definition").ProjectIntegrationDefinition}
 * and, ultimately, outside RC4.0.
 */

import type { Slug } from "@/features/forever-database";

import type { ProjectIntegrationId } from "./types";

/**
 * The scope an integration spans.
 *
 * `project` wires a single project end-to-end, `developer` wires a developer's
 * whole project set, `portfolio` wires a curated group of projects, and
 * `composite` spans more than one of those in a single orchestration.
 */
export type ProjectIntegrationScope = "project" | "developer" | "portfolio" | "composite";

/** Every {@link ProjectIntegrationScope}, in a stable declared order. */
export const PROJECT_INTEGRATION_SCOPES = [
  "project",
  "developer",
  "portfolio",
  "composite",
] as const satisfies readonly ProjectIntegrationScope[];

/** Runtime guard: whether a value is a known {@link ProjectIntegrationScope}. */
export function isKnownProjectIntegrationScope(
  value: unknown,
): value is ProjectIntegrationScope {
  return (
    typeof value === "string" && (PROJECT_INTEGRATION_SCOPES as readonly string[]).includes(value)
  );
}

/** The stable identity of an integration. */
export interface ProjectIntegrationIdentity {
  /** Stable surrogate id, e.g. `integ_coralina`. */
  id: ProjectIntegrationId;
  /** URL- and file-safe identifier, e.g. `coralina`. */
  slug: Slug;
  /** Human-readable display name, e.g. `Coralina Integration`. */
  name: string;
  /** What the integration spans. */
  scope: ProjectIntegrationScope;
}
