import { validateConnectorDefinition } from "@/features/forever-connectors";
import { validatePipelineDefinition } from "@/features/forever-pipeline";
import {
  addProjectIntegrationEntry,
  emptyProjectIntegrationRegistry,
  validateProjectIntegrationDefinition,
  validateProjectIntegrationRegistry,
} from "@/features/forever-project-integration";
import { describe, expect, it } from "vitest";

import { CORALINA_PROJECT_ID } from "../identity";
import { CORALINA_CONNECTOR_DEFINITION } from "../integration/coralina-connector";
import {
  buildCoralinaIntegrationBundle,
  CORALINA_INTEGRATION_DEFINITION,
} from "../integration/coralina-integration";
import { CORALINA_PIPELINE_DEFINITION } from "../integration/coralina-pipeline";

const errorsOf = (issues: { severity: string }[]) => issues.filter((i) => i.severity === "error");

describe("Coralina connector / pipeline / integration definitions", () => {
  it("connector definition passes RC3.4 validation", () => {
    expect(errorsOf(validateConnectorDefinition(CORALINA_CONNECTOR_DEFINITION))).toEqual([]);
    expect(CORALINA_CONNECTOR_DEFINITION.identity.protocol).toBe("file");
    expect(CORALINA_CONNECTOR_DEFINITION.identity.targetSystem).toBe("forever_database");
  });

  it("pipeline definition passes RC3.5 validation", () => {
    expect(errorsOf(validatePipelineDefinition(CORALINA_PIPELINE_DEFINITION))).toEqual([]);
    expect(CORALINA_PIPELINE_DEFINITION.identity.mode).toBe("import");
  });

  it("integration definition passes RC4.0 validation with no errors or warnings", () => {
    const issues = validateProjectIntegrationDefinition(CORALINA_INTEGRATION_DEFINITION);
    // Every classified step carries its implied reference, so there are no
    // reference warnings either.
    expect(issues).toEqual([]);
    expect(CORALINA_INTEGRATION_DEFINITION.projectId).toBe(CORALINA_PROJECT_ID);
    expect(CORALINA_INTEGRATION_DEFINITION.identity.scope).toBe("project");
  });

  it("the integration registers cleanly in a registry", () => {
    const registry = addProjectIntegrationEntry(
      emptyProjectIntegrationRegistry("coralina-integrations"),
      { definition: CORALINA_INTEGRATION_DEFINITION, enabled: true },
    );
    const validation = validateProjectIntegrationRegistry(registry);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  it("the bundle populates fresh registries that resolve every definition", () => {
    const bundle = buildCoralinaIntegrationBundle();
    expect(bundle.sourceRegistry.list()).toHaveLength(6);
    expect(bundle.connectorRegistry.has(CORALINA_CONNECTOR_DEFINITION.identity.id)).toBe(true);
    expect(bundle.pipelineRegistry.has(CORALINA_PIPELINE_DEFINITION.identity.id)).toBe(true);
    expect(bundle.integrationRegistry.has(CORALINA_INTEGRATION_DEFINITION.identity.id)).toBe(true);
    // fresh instances each call — no shared mutable state
    expect(buildCoralinaIntegrationBundle().sourceRegistry).not.toBe(bundle.sourceRegistry);
  });
});
