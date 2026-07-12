/**
 * Coralina project integration definition and bundle (RC4.0).
 *
 * The {@link ProjectIntegrationDefinition} wires the verified Coralina sources,
 * connector, and pipeline into one project-scoped integration, and the bundle
 * pairs it with freshly-populated registries for every foundation it references.
 * It is declarative only — RC4.0 runs no stage and moves no record.
 *
 * Every `sourceId`, `connectorId`, and `pipelineId` the definition names is a
 * real Coralina definition created in this module, and `projectId` is the
 * canonical Coralina project id — so the cross-foundation reference validation
 * (which closes the RC4.0 boundary for this slice) resolves all of them.
 */

import { ConnectorDefinitionRegistry } from "@/features/forever-connectors";
import { PipelineDefinitionRegistry } from "@/features/forever-pipeline";
import {
  defaultProjectIntegrationPolicy,
  defineProjectIntegration,
  projectIntegrationStage,
  projectIntegrationStep,
  projectIntegrationVersion,
  ProjectIntegrationDefinitionRegistry,
  type ProjectIntegrationDefinition,
} from "@/features/forever-project-integration";
import { SourceDefinitionRegistry } from "@/features/forever-source-registry";

import {
  CORALINA_BROCHURE_SOURCE_ID,
  CORALINA_CONNECTOR_ID,
  CORALINA_DOCUMENTS_SOURCE_ID,
  CORALINA_INTEGRATION_ID,
  CORALINA_MEDIA_SOURCE_ID,
  CORALINA_PIPELINE_ID,
  CORALINA_PRICE_LIST_SOURCE_ID,
  CORALINA_PROJECT_ID,
} from "../identity";
import { CORALINA_SOURCE_DEFINITIONS } from "../sources";
import { CORALINA_CONNECTOR_DEFINITION } from "./coralina-connector";
import { CORALINA_PIPELINE_DEFINITION } from "./coralina-pipeline";

/** The Coralina project integration definition. */
export const CORALINA_INTEGRATION_DEFINITION: ProjectIntegrationDefinition =
  defineProjectIntegration({
    identity: {
      id: CORALINA_INTEGRATION_ID,
      slug: "coralina",
      name: "Coralina Integration",
      scope: "project",
    },
    version: projectIntegrationVersion(0, 1, 0),
    stages: [
      projectIntegrationStage("acquire", "Acquire", "acquire", [
        projectIntegrationStep("bind_price_list", "Bind price list source", "source", {
          sourceId: CORALINA_PRICE_LIST_SOURCE_ID,
          entityKind: "project",
        }),
        projectIntegrationStep("bind_brochure", "Bind brochure source", "source", {
          sourceId: CORALINA_BROCHURE_SOURCE_ID,
          entityKind: "project",
        }),
        projectIntegrationStep("bind_documents", "Bind documents source", "source", {
          sourceId: CORALINA_DOCUMENTS_SOURCE_ID,
          entityKind: "document",
        }),
        projectIntegrationStep("bind_media", "Bind media source", "source", {
          sourceId: CORALINA_MEDIA_SOURCE_ID,
          entityKind: "media",
        }),
        projectIntegrationStep("bind_connector", "Bind developer-package connector", "connector", {
          connectorId: CORALINA_CONNECTOR_ID,
          dependsOn: ["bind_price_list"],
        }),
      ]),
      projectIntegrationStage("process", "Process", "process", [
        projectIntegrationStep("run_pipeline", "Run Coralina import pipeline", "pipeline", {
          pipelineId: CORALINA_PIPELINE_ID,
          entityKind: "project",
        }),
      ]),
      projectIntegrationStage("reconcile", "Reconcile", "reconcile", [
        projectIntegrationStep("sync_database", "Reconcile with Forever database", "sync", {
          entityKind: "project",
          system: "forever_database",
          direction: "push",
        }),
      ]),
      projectIntegrationStage("verify", "Verify", "verify", [
        projectIntegrationStep("verify_ready", "Verify data readiness", "verify", {
          entityKind: "project",
        }),
      ]),
    ],
    entities: ["project", "document", "media"],
    projectId: CORALINA_PROJECT_ID,
    policy: defaultProjectIntegrationPolicy(),
    metadata: {
      description: "First real project vertical slice: Coralina Kamala end-to-end wiring.",
      owner: "Forever intake",
      region: "Phuket",
      tags: ["coralina", "vertical-slice", "rc4.1"],
    },
  });

/**
 * The complete Coralina integration bundle: every foundation definition plus a
 * freshly-populated in-memory registry for each. Fresh registries are built on
 * every call so the bundle is a pure, deterministic value with no shared state.
 */
export interface CoralinaIntegrationBundle {
  sourceRegistry: SourceDefinitionRegistry;
  connectorRegistry: ConnectorDefinitionRegistry;
  pipelineRegistry: PipelineDefinitionRegistry;
  integrationRegistry: ProjectIntegrationDefinitionRegistry;
  integration: ProjectIntegrationDefinition;
}

/** Build the Coralina integration bundle with fresh, populated registries. */
export function buildCoralinaIntegrationBundle(): CoralinaIntegrationBundle {
  const sourceRegistry = new SourceDefinitionRegistry();
  for (const source of CORALINA_SOURCE_DEFINITIONS) sourceRegistry.register(source);

  const connectorRegistry = new ConnectorDefinitionRegistry();
  connectorRegistry.register(CORALINA_CONNECTOR_DEFINITION);

  const pipelineRegistry = new PipelineDefinitionRegistry();
  pipelineRegistry.register(CORALINA_PIPELINE_DEFINITION);

  const integrationRegistry = new ProjectIntegrationDefinitionRegistry();
  integrationRegistry.register(CORALINA_INTEGRATION_DEFINITION);

  return {
    sourceRegistry,
    connectorRegistry,
    pipelineRegistry,
    integrationRegistry,
    integration: CORALINA_INTEGRATION_DEFINITION,
  };
}
