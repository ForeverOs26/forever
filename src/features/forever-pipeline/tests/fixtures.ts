/**
 * Forever Pipeline — shared test fixtures.
 *
 * Deterministic builders for identities, versions, steps, stages, policies,
 * definitions, entries, and registries. Every builder takes a partial override
 * so tests state only what they exercise, and the defaults describe a realistic
 * future pipeline (importing the Coralina project set from the developer
 * website) so the fixtures double as documentation.
 */

import type { PipelineDefinition } from "../definition";
import type { PipelineRegistry, PipelineRegistryEntry } from "../entry";
import type { PipelineIdentity } from "../identity";
import { defaultPipelinePolicy } from "../policy";
import { pipelineStage, type PipelineStage } from "../stage";
import { pipelineStep } from "../step";
import { pipelineVersion } from "../version";

export function makeIdentity(overrides: Partial<PipelineIdentity> = {}): PipelineIdentity {
  return {
    id: "pipe_coralina_import",
    slug: "coralina-import",
    name: "Coralina Import",
    mode: "import",
    ...overrides,
  };
}

export function makeStages(): PipelineStage[] {
  return [
    pipelineStage("ingest", "Ingest", "ingest", [
      pipelineStep("acquire", "Acquire source", "source", {
        sourceId: "src_developer_website",
        connectorId: "conn_developer_website",
      }),
      pipelineStep("import_project", "Import project", "import", {
        entityKind: "project",
        dependsOn: ["acquire"],
      }),
    ]),
    pipelineStage("shape", "Shape", "transform", [
      pipelineStep("normalize_project", "Normalize project", "normalize", {
        entityKind: "project",
      }),
    ]),
    pipelineStage("check", "Check", "validate", [
      pipelineStep("validate_project", "Validate project", "validate", {
        entityKind: "project",
      }),
    ]),
    pipelineStage("deliver", "Deliver", "distribute", [
      pipelineStep("sync_database", "Sync to database", "sync", {
        entityKind: "project",
        direction: "push",
      }),
    ]),
  ];
}

export function makeDefinition(overrides: Partial<PipelineDefinition> = {}): PipelineDefinition {
  return {
    identity: makeIdentity(),
    version: pipelineVersion(0, 1, 0),
    stages: makeStages(),
    entities: ["project", "media"],
    policy: defaultPipelinePolicy(),
    ...overrides,
  };
}

export function makeEntry(overrides: Partial<PipelineRegistryEntry> = {}): PipelineRegistryEntry {
  return {
    definition: makeDefinition(),
    enabled: false,
    registeredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeRegistry(overrides: Partial<PipelineRegistry> = {}): PipelineRegistry {
  return {
    id: "forever-pipelines",
    name: "Forever Pipelines",
    entries: [makeEntry()],
    ...overrides,
  };
}
