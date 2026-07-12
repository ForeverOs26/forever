import { SourceDefinitionRegistry } from "@/features/forever-source-registry";
import { describe, expect, it } from "vitest";

import { buildCoralinaRecord } from "../adapters/coralina-canonical";
import { CORALINA_PROJECT_ID } from "../identity";
import { buildCoralinaIntegrationBundle } from "../integration/coralina-integration";
import { resolveCoralinaReferences } from "../validation/coralina-references";

describe("Coralina cross-foundation reference resolution (closes RC4.0 boundary)", () => {
  it("resolves every reference for the real bundle", () => {
    const resolution = resolveCoralinaReferences();
    expect(resolution.unresolved).toEqual([]);
    expect(resolution.valid).toBe(true);
  });

  it("covers source, connector, pipeline, project, and canonical references", () => {
    const kinds = new Set(resolveCoralinaReferences().checks.map((c) => c.kind));
    for (const kind of [
      "sourceId",
      "connectorId",
      "pipelineId",
      "connectorSourceId",
      "pipelineSourceId",
      "projectId",
      "developerId",
      "locationId",
      "units",
      "documents",
      "media",
      "canonicalIntegrity",
    ]) {
      expect(kinds.has(kind)).toBe(true);
    }
  });

  it("confirms projectId is consistent across integration, record, and identity", () => {
    const projectCheck = resolveCoralinaReferences().checks.find((c) => c.kind === "projectId");
    expect(projectCheck?.resolved).toBe(true);
    expect(projectCheck?.target).toBe(CORALINA_PROJECT_ID);
  });

  it("treats the absent developer as a consistent absent reference", () => {
    const dev = resolveCoralinaReferences().checks.find((c) => c.kind === "developerId");
    expect(dev?.resolved).toBe(true);
    expect(dev?.message.toLowerCase()).toContain("no developer");
  });

  it("flags an unresolved source reference when the source registry is empty", () => {
    const bundle = buildCoralinaIntegrationBundle();
    const broken = { ...bundle, sourceRegistry: new SourceDefinitionRegistry() };
    const resolution = resolveCoralinaReferences(broken, buildCoralinaRecord());
    expect(resolution.valid).toBe(false);
    expect(resolution.unresolved.some((c) => c.kind === "sourceId")).toBe(true);
  });

  it("does not mutate the record it validates", () => {
    const record = buildCoralinaRecord();
    const snapshot = structuredClone(record);
    resolveCoralinaReferences(buildCoralinaIntegrationBundle(), record);
    expect(record).toEqual(snapshot);
  });
});
