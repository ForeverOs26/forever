/**
 * Forever Project Integration — integration definition.
 *
 * A {@link ProjectIntegrationDefinition} is the complete, declarative
 * description of one integration: its identity and version, the ordered stages
 * (and their steps) it is composed of, which canonical entities it handles, the
 * canonical project it targets, the optional behavioural policy that governs it,
 * and optional descriptive metadata. It is the unit the registry stores and the
 * validation pipeline judges — and the seam where the whole system's foundations
 * come together for one project.
 *
 * The definition reuses the neighbouring foundations rather than restating them:
 * `entities` are the Forever Import (RC3.1) entity kinds, `projectId` is a
 * Forever Database (RC3.0) id, its steps reference Forever Source Registry
 * (RC3.3) sources, Forever Connectors (RC3.4) connectors, and Forever Pipeline
 * (RC3.5) pipelines by id, and its policy reuses the Forever Sync (RC3.2) retry
 * shape and the RC3.5 execution/error vocabularies. It carries no live handle,
 * connection, credential, or data — it describes what a run *would* do, never a
 * run itself.
 */

import type { ForeverId } from "@/features/forever-database";

import type { ProjectIntegrationIdentity } from "./identity";
import type { ProjectIntegrationMetadata } from "./metadata";
import type { ProjectIntegrationPolicy } from "./policy";
import type { ProjectIntegrationStage } from "./stage";
import type { ProjectIntegrationEntityKind } from "./types";
import type { ProjectIntegrationVersion } from "./version";

/** The full declarative description of one integration. */
export interface ProjectIntegrationDefinition {
  identity: ProjectIntegrationIdentity;
  version: ProjectIntegrationVersion;
  /** The ordered stages this integration is composed of. */
  stages: ProjectIntegrationStage[];
  /** Canonical entity kinds this integration handles. Reuses the RC3.1 kinds. */
  entities: ProjectIntegrationEntityKind[];
  /** The canonical project this integration targets. Reuses the RC3.0 id. */
  projectId?: ForeverId;
  /** Optional behavioural contract governing the integration. */
  policy?: ProjectIntegrationPolicy;
  metadata?: ProjectIntegrationMetadata;
}

/**
 * Identity helper that pins an object to the {@link ProjectIntegrationDefinition}
 * shape.
 *
 * Gives call sites full type-checking and inference without forcing a factory;
 * the returned value is the definition unchanged.
 */
export function defineProjectIntegration(
  definition: ProjectIntegrationDefinition,
): ProjectIntegrationDefinition {
  return definition;
}
