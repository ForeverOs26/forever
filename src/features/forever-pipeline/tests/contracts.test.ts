import { describe, expect, it } from "vitest";

import {
  definePipeline,
  definePipelineProvider,
  pipelineHandles,
  pipelineProviderStageCount,
  pipelineProviderStepCount,
  pipelineUsesConnector,
  pipelineUsesSource,
  type PipelineProvider,
} from "..";
import { makeDefinition } from "./fixtures";

describe("pipeline provider contract", () => {
  const provider: PipelineProvider = definePipelineProvider({
    definition: makeDefinition(),
  });

  it("reports handled entity kinds", () => {
    expect(pipelineHandles(provider, "project")).toBe(true);
    expect(pipelineHandles(provider, "document")).toBe(false);
  });

  it("reports stage and step counts", () => {
    expect(pipelineProviderStageCount(provider)).toBe(4);
    expect(pipelineProviderStepCount(provider)).toBe(5);
  });

  it("reports referenced sources and connectors", () => {
    expect(pipelineUsesSource(provider, "src_developer_website")).toBe(true);
    expect(pipelineUsesSource(provider, "src_missing")).toBe(false);
    expect(pipelineUsesConnector(provider, "conn_developer_website")).toBe(true);
    expect(pipelineUsesConnector(provider, "conn_missing")).toBe(false);
  });

  it("returns the provider and definition unchanged", () => {
    const definition = definePipeline(makeDefinition());
    const wrapped = definePipelineProvider({ definition });
    expect(wrapped.definition).toBe(definition);
  });
});
