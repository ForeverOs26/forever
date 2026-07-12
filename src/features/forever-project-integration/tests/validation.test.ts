import { describe, expect, it } from "vitest";

import {
  projectIntegrationStage,
  projectIntegrationStep,
  validateProjectIntegrationDefinition,
  validateProjectIntegrationIdentity,
  validateProjectIntegrationPolicy,
  validateProjectIntegrationRegistry,
  validateProjectIntegrationStage,
  validateProjectIntegrationVersion,
  type ProjectIntegrationIdentity,
  type ProjectIntegrationPolicy,
} from "..";
import { makeDefinition, makeEntry, makeIdentity, makeRegistry } from "./fixtures";

describe("identity validation", () => {
  it("accepts a well-formed identity", () => {
    expect(validateProjectIntegrationIdentity(makeIdentity())).toEqual([]);
  });

  it("flags missing fields and an unknown scope", () => {
    const identity = makeIdentity({
      id: "",
      slug: "",
      name: "",
      scope: "galaxy" as ProjectIntegrationIdentity["scope"],
    });
    const codes = validateProjectIntegrationIdentity(identity).map((i) => i.code);
    expect(codes).toContain("missing_integration_id");
    expect(codes).toContain("missing_integration_slug");
    expect(codes).toContain("missing_integration_name");
    expect(codes).toContain("unknown_integration_scope");
  });
});

describe("version validation", () => {
  it("rejects negative and non-integer parts", () => {
    const codes = validateProjectIntegrationVersion({ major: -1, minor: 1.5, patch: 0 }).map(
      (i) => i.code,
    );
    expect(codes).toEqual(["invalid_version_part", "invalid_version_part"]);
  });
});

describe("policy validation", () => {
  it("accepts the default policy", () => {
    expect(validateProjectIntegrationPolicy(makeDefinition().policy!)).toEqual([]);
  });

  it("flags unknown modes/strategies, bad retries, and bad concurrency", () => {
    const policy: ProjectIntegrationPolicy = {
      id: "p",
      executionMode: "burst" as ProjectIntegrationPolicy["executionMode"],
      onError: "ignore" as ProjectIntegrationPolicy["onError"],
      retry: { maxAttempts: 0, backoff: "warp" as ProjectIntegrationPolicy["retry"]["backoff"] },
      dryRunOnly: true,
      maxConcurrency: 0,
    };
    const codes = validateProjectIntegrationPolicy(policy).map((i) => i.code);
    expect(codes).toContain("unknown_execution_mode");
    expect(codes).toContain("unknown_error_strategy");
    expect(codes).toContain("invalid_retry_attempts");
    expect(codes).toContain("unknown_backoff");
    expect(codes).toContain("invalid_max_concurrency");
  });
});

describe("step validation", () => {
  it("flags an unknown system and an unknown direction", () => {
    const stage = projectIntegrationStage("s", "S", "reconcile", [
      projectIntegrationStep("a", "A", "sync", {
        system: "smoke_signal" as never,
        direction: "sideways" as never,
      }),
    ]);
    const codes = validateProjectIntegrationStage(stage, 0).map((i) => i.code);
    expect(codes).toContain("unknown_step_system");
    expect(codes).toContain("unknown_step_direction");
  });
});

describe("stage validation", () => {
  it("accepts a well-formed stage", () => {
    const stage = projectIntegrationStage("s", "S", "acquire", [
      projectIntegrationStep("a", "A", "source", { sourceId: "src_x" }),
      projectIntegrationStep("b", "B", "pipeline", { pipelineId: "pipe_x", dependsOn: ["a"] }),
    ]);
    expect(validateProjectIntegrationStage(stage, 0)).toEqual([]);
  });

  it("flags empty stages, unknown kinds, duplicate step ids, and self-dependency", () => {
    const stage = projectIntegrationStage("", "", "phase" as never, [
      projectIntegrationStep("a", "A", "source", { sourceId: "src_x", dependsOn: ["a", "a"] }),
      projectIntegrationStep("a", "A2", "source", { sourceId: "src_x" }),
    ]);
    const codes = validateProjectIntegrationStage(stage, 0).map((i) => i.code);
    expect(codes).toContain("missing_stage_id");
    expect(codes).toContain("missing_stage_name");
    expect(codes).toContain("unknown_stage_kind");
    expect(codes).toContain("duplicate_step_id");
    expect(codes).toContain("self_dependency");
    expect(codes).toContain("duplicate_dependency");
  });

  it("flags an unresolved dependency and a dependency cycle", () => {
    const unresolved = projectIntegrationStage("s", "S", "acquire", [
      projectIntegrationStep("a", "A", "source", { sourceId: "src_x", dependsOn: ["ghost"] }),
    ]);
    expect(validateProjectIntegrationStage(unresolved, 0).map((i) => i.code)).toContain(
      "unresolved_dependency",
    );

    const cyclic = projectIntegrationStage("s", "S", "acquire", [
      projectIntegrationStep("a", "A", "source", { sourceId: "src_x", dependsOn: ["b"] }),
      projectIntegrationStep("b", "B", "pipeline", { pipelineId: "pipe_x", dependsOn: ["a"] }),
    ]);
    expect(validateProjectIntegrationStage(cyclic, 0).map((i) => i.code)).toContain(
      "cyclic_dependencies",
    );
  });
});

describe("definition validation", () => {
  it("accepts a complete definition", () => {
    expect(validateProjectIntegrationDefinition(makeDefinition())).toEqual([]);
  });

  it("requires stages and entities and rejects duplicates", () => {
    const codes = validateProjectIntegrationDefinition(
      makeDefinition({ stages: [], entities: [] }),
    ).map((i) => i.code);
    expect(codes).toContain("no_stages");
    expect(codes).toContain("no_entities");
  });

  it("flags duplicate stage ids and duplicate entities", () => {
    const stage = projectIntegrationStage("dup", "Dup", "acquire", [
      projectIntegrationStep("a", "A", "source", { sourceId: "src_x" }),
    ]);
    const codes = validateProjectIntegrationDefinition(
      makeDefinition({ stages: [stage, stage], entities: ["project", "project"] }),
    ).map((i) => i.code);
    expect(codes).toContain("duplicate_stage_id");
    expect(codes).toContain("duplicate_entity");
  });

  it("warns when a step touches an entity the integration does not declare", () => {
    const stage = projectIntegrationStage("s", "S", "acquire", [
      projectIntegrationStep("a", "A", "source", { sourceId: "src_x", entityKind: "document" }),
    ]);
    const issues = validateProjectIntegrationDefinition(
      makeDefinition({ stages: [stage], entities: ["project"] }),
    );
    const warning = issues.find((i) => i.code === "undeclared_step_entity");
    expect(warning?.severity).toBe("warning");
  });

  it("warns when a classified step is missing the reference its kind implies", () => {
    const stage = projectIntegrationStage("s", "S", "acquire", [
      projectIntegrationStep("a", "A", "source"),
      projectIntegrationStep("b", "B", "connector"),
      projectIntegrationStep("c", "C", "pipeline"),
      projectIntegrationStep("d", "D", "sync"),
    ]);
    const codes = validateProjectIntegrationDefinition(
      makeDefinition({ stages: [stage], entities: ["project"] }),
    ).map((i) => i.code);
    expect(codes).toContain("source_step_without_source");
    expect(codes).toContain("connector_step_without_connector");
    expect(codes).toContain("pipeline_step_without_pipeline");
    expect(codes).toContain("sync_step_without_system");
  });
});

describe("registry validation", () => {
  it("accepts a coherent registry", () => {
    const result = validateProjectIntegrationRegistry(makeRegistry());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a missing registry id", () => {
    const result = validateProjectIntegrationRegistry(makeRegistry({ id: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("missing_registry_id");
  });

  it("rejects duplicate integration ids and natural keys", () => {
    const result = validateProjectIntegrationRegistry(
      makeRegistry({ entries: [makeEntry(), makeEntry()] }),
    );
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("duplicate_integration_id");
    expect(codes).toContain("duplicate_integration_key");
    expect(result.valid).toBe(false);
  });

  it("surfaces a non-boolean enabled flag as an error", () => {
    const result = validateProjectIntegrationRegistry(
      makeRegistry({ entries: [makeEntry({ enabled: "yes" as never })] }),
    );
    expect(result.errors.map((e) => e.code)).toContain("invalid_enabled_flag");
  });

  it("partitions warnings without invalidating the registry", () => {
    const stage = projectIntegrationStage("s", "S", "acquire", [
      projectIntegrationStep("a", "A", "source", { sourceId: "src_x", entityKind: "media" }),
    ]);
    const entry = makeEntry({
      definition: makeDefinition({ stages: [stage], entities: ["project"] }),
    });
    const result = validateProjectIntegrationRegistry(makeRegistry({ entries: [entry] }));
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("undeclared_step_entity");
  });
});
