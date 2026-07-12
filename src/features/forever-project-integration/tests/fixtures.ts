/**
 * Forever Project Integration — shared test fixtures.
 *
 * Deterministic builders for identities, versions, steps, stages, policies,
 * definitions, entries, and registries. Every builder takes a partial override so
 * tests state only what they exercise, and the defaults describe a realistic
 * future integration (bringing the Coralina project end-to-end from the developer
 * website, through the import pipeline, to the Forever database) so the fixtures
 * double as documentation.
 */

import type { ProjectIntegrationDefinition } from "../definition";
import type {
  ProjectIntegrationRegistry,
  ProjectIntegrationRegistryEntry,
} from "../entry";
import type { ProjectIntegrationIdentity } from "../identity";
import { defaultProjectIntegrationPolicy } from "../policy";
import { projectIntegrationStage, type ProjectIntegrationStage } from "../stage";
import { projectIntegrationStep } from "../step";
import { projectIntegrationVersion } from "../version";

export function makeIdentity(
  overrides: Partial<ProjectIntegrationIdentity> = {},
): ProjectIntegrationIdentity {
  return {
    id: "integ_coralina",
    slug: "coralina",
    name: "Coralina Integration",
    scope: "project",
    ...overrides,
  };
}

export function makeStages(): ProjectIntegrationStage[] {
  return [
    projectIntegrationStage("acquire", "Acquire", "acquire", [
      projectIntegrationStep("bind_source", "Bind developer website", "source", {
        sourceId: "src_developer_website",
        entityKind: "project",
      }),
      projectIntegrationStep("bind_connector", "Bind website connector", "connector", {
        connectorId: "conn_developer_website",
        dependsOn: ["bind_source"],
      }),
    ]),
    projectIntegrationStage("process", "Process", "process", [
      projectIntegrationStep("run_import", "Run import pipeline", "pipeline", {
        pipelineId: "pipe_coralina_import",
        entityKind: "project",
      }),
    ]),
    projectIntegrationStage("reconcile", "Reconcile", "reconcile", [
      projectIntegrationStep("sync_database", "Sync to Forever database", "sync", {
        entityKind: "project",
        system: "forever_database",
        direction: "push",
      }),
    ]),
    projectIntegrationStage("verify", "Verify", "verify", [
      projectIntegrationStep("verify_ready", "Verify readiness", "verify", {
        entityKind: "project",
      }),
    ]),
  ];
}

export function makeDefinition(
  overrides: Partial<ProjectIntegrationDefinition> = {},
): ProjectIntegrationDefinition {
  return {
    identity: makeIdentity(),
    version: projectIntegrationVersion(0, 1, 0),
    stages: makeStages(),
    entities: ["project", "media"],
    projectId: "proj_coralina",
    policy: defaultProjectIntegrationPolicy(),
    ...overrides,
  };
}

export function makeEntry(
  overrides: Partial<ProjectIntegrationRegistryEntry> = {},
): ProjectIntegrationRegistryEntry {
  return {
    definition: makeDefinition(),
    enabled: false,
    registeredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeRegistry(
  overrides: Partial<ProjectIntegrationRegistry> = {},
): ProjectIntegrationRegistry {
  return {
    id: "forever-integrations",
    name: "Forever Integrations",
    entries: [makeEntry()],
    ...overrides,
  };
}
