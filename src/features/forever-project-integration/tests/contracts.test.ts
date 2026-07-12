import { describe, expect, it } from "vitest";

import {
  defineProjectIntegration,
  defineProjectIntegrationProvider,
  projectIntegrationHandles,
  projectIntegrationProviderStageCount,
  projectIntegrationProviderStepCount,
  projectIntegrationUsesConnector,
  projectIntegrationUsesPipeline,
  projectIntegrationUsesSource,
  projectIntegrationUsesSystem,
  type ProjectIntegrationProvider,
} from "..";
import { makeDefinition } from "./fixtures";

describe("integration provider contract", () => {
  const provider: ProjectIntegrationProvider = defineProjectIntegrationProvider({
    definition: makeDefinition(),
  });

  it("reports handled entity kinds", () => {
    expect(projectIntegrationHandles(provider, "project")).toBe(true);
    expect(projectIntegrationHandles(provider, "document")).toBe(false);
  });

  it("reports stage and step counts", () => {
    expect(projectIntegrationProviderStageCount(provider)).toBe(4);
    expect(projectIntegrationProviderStepCount(provider)).toBe(5);
  });

  it("reports referenced sources, connectors, pipelines, and systems", () => {
    expect(projectIntegrationUsesSource(provider, "src_developer_website")).toBe(true);
    expect(projectIntegrationUsesSource(provider, "src_missing")).toBe(false);
    expect(projectIntegrationUsesConnector(provider, "conn_developer_website")).toBe(true);
    expect(projectIntegrationUsesConnector(provider, "conn_missing")).toBe(false);
    expect(projectIntegrationUsesPipeline(provider, "pipe_coralina_import")).toBe(true);
    expect(projectIntegrationUsesPipeline(provider, "pipe_missing")).toBe(false);
    expect(projectIntegrationUsesSystem(provider, "forever_database")).toBe(true);
    expect(projectIntegrationUsesSystem(provider, "crm")).toBe(false);
  });

  it("returns the provider and definition unchanged", () => {
    const definition = defineProjectIntegration(makeDefinition());
    const wrapped = defineProjectIntegrationProvider({ definition });
    expect(wrapped.definition).toBe(definition);
  });
});
