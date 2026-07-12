/**
 * Coralina pipeline definition (RC3.5).
 *
 * One {@link PipelineDefinition} describing the ordered ingest → transform →
 * validate → distribute path that would bring Coralina from its verified sources
 * to the Forever Database. It is architecture only: it references sources and the
 * connector by id, runs nothing, and moves no record.
 *
 * Every `sourceId`/`connectorId` it names is a real Coralina definition created
 * in this module, so the cross-foundation reference validation can resolve them.
 */

import {
  definePipeline,
  pipelineStage,
  pipelineStep,
  pipelineVersion,
  type PipelineDefinition,
} from "@/features/forever-pipeline";

import {
  CORALINA_BROCHURE_SOURCE_ID,
  CORALINA_CONNECTOR_ID,
  CORALINA_DOCUMENTS_SOURCE_ID,
  CORALINA_MEDIA_SOURCE_ID,
  CORALINA_PIPELINE_ID,
  CORALINA_PRICE_LIST_SOURCE_ID,
} from "../identity";

/** The Coralina import pipeline. */
export const CORALINA_PIPELINE_DEFINITION: PipelineDefinition = definePipeline({
  identity: {
    id: CORALINA_PIPELINE_ID,
    slug: "coralina-import",
    name: "Coralina Import",
    mode: "import",
  },
  version: pipelineVersion(0, 1, 0),
  stages: [
    pipelineStage("ingest", "Ingest", "ingest", [
      pipelineStep("acquire_price_list", "Acquire price list", "source", {
        sourceId: CORALINA_PRICE_LIST_SOURCE_ID,
        entityKind: "project",
      }),
      pipelineStep("acquire_brochure", "Acquire brochure", "source", {
        sourceId: CORALINA_BROCHURE_SOURCE_ID,
        entityKind: "project",
      }),
      pipelineStep("acquire_documents", "Acquire documents", "source", {
        sourceId: CORALINA_DOCUMENTS_SOURCE_ID,
        entityKind: "document",
      }),
      pipelineStep("acquire_media", "Acquire media", "source", {
        sourceId: CORALINA_MEDIA_SOURCE_ID,
        entityKind: "media",
      }),
      pipelineStep("connect_package", "Connect developer package", "connect", {
        connectorId: CORALINA_CONNECTOR_ID,
        dependsOn: ["acquire_price_list", "acquire_brochure"],
      }),
    ]),
    pipelineStage("transform", "Transform", "transform", [
      pipelineStep("normalize_records", "Normalize to canonical records", "normalize", {
        entityKind: "project",
      }),
    ]),
    pipelineStage("validate", "Validate", "validate", [
      pipelineStep("validate_records", "Validate canonical records", "validate", {
        entityKind: "project",
      }),
    ]),
    pipelineStage("distribute", "Distribute", "distribute", [
      pipelineStep("sync_database", "Sync to Forever database", "sync", {
        entityKind: "project",
        direction: "push",
      }),
    ]),
  ],
  entities: ["project", "document", "media"],
});
