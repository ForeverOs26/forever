import { describe, expect, it } from "vitest";

import {
  pipelineStage,
  pipelineStep,
  validatePipelineDefinition,
  validatePipelineIdentity,
  validatePipelinePolicy,
  validatePipelineRegistry,
  validatePipelineStage,
  validatePipelineVersion,
  type PipelineIdentity,
  type PipelinePolicy,
} from "..";
import { makeDefinition, makeEntry, makeIdentity, makeRegistry } from "./fixtures";

describe("identity validation", () => {
  it("accepts a well-formed identity", () => {
    expect(validatePipelineIdentity(makeIdentity())).toEqual([]);
  });

  it("flags missing fields and an unknown mode", () => {
    const identity = makeIdentity({
      id: "",
      slug: "",
      name: "",
      mode: "teleport" as PipelineIdentity["mode"],
    });
    const codes = validatePipelineIdentity(identity).map((i) => i.code);
    expect(codes).toContain("missing_pipeline_id");
    expect(codes).toContain("missing_pipeline_slug");
    expect(codes).toContain("missing_pipeline_name");
    expect(codes).toContain("unknown_pipeline_mode");
  });
});

describe("version validation", () => {
  it("rejects negative and non-integer parts", () => {
    const codes = validatePipelineVersion({ major: -1, minor: 1.5, patch: 0 }).map((i) => i.code);
    expect(codes).toEqual(["invalid_version_part", "invalid_version_part"]);
  });
});

describe("policy validation", () => {
  it("accepts the default policy", () => {
    expect(validatePipelinePolicy(makeDefinition().policy!)).toEqual([]);
  });

  it("flags unknown modes/strategies, bad retries, and bad concurrency", () => {
    const policy: PipelinePolicy = {
      id: "p",
      executionMode: "burst" as PipelinePolicy["executionMode"],
      onError: "ignore" as PipelinePolicy["onError"],
      retry: { maxAttempts: 0, backoff: "warp" as PipelinePolicy["retry"]["backoff"] },
      dryRunOnly: true,
      maxConcurrency: 0,
    };
    const codes = validatePipelinePolicy(policy).map((i) => i.code);
    expect(codes).toContain("unknown_execution_mode");
    expect(codes).toContain("unknown_error_strategy");
    expect(codes).toContain("invalid_retry_attempts");
    expect(codes).toContain("unknown_backoff");
    expect(codes).toContain("invalid_max_concurrency");
  });
});

describe("stage validation", () => {
  it("accepts a well-formed stage", () => {
    const stage = pipelineStage("s", "S", "ingest", [
      pipelineStep("a", "A", "import"),
      pipelineStep("b", "B", "normalize", { dependsOn: ["a"] }),
    ]);
    expect(validatePipelineStage(stage, 0)).toEqual([]);
  });

  it("flags empty stages, unknown kinds, duplicate step ids, and self-dependency", () => {
    const stage = pipelineStage("", "", "phase" as never, [
      pipelineStep("a", "A", "import", { dependsOn: ["a", "a"] }),
      pipelineStep("a", "A2", "import"),
    ]);
    const codes = validatePipelineStage(stage, 0).map((i) => i.code);
    expect(codes).toContain("missing_stage_id");
    expect(codes).toContain("missing_stage_name");
    expect(codes).toContain("unknown_stage_kind");
    expect(codes).toContain("duplicate_step_id");
    expect(codes).toContain("self_dependency");
    expect(codes).toContain("duplicate_dependency");
  });

  it("flags an unresolved dependency and a dependency cycle", () => {
    const unresolved = pipelineStage("s", "S", "ingest", [
      pipelineStep("a", "A", "import", { dependsOn: ["ghost"] }),
    ]);
    expect(validatePipelineStage(unresolved, 0).map((i) => i.code)).toContain(
      "unresolved_dependency",
    );

    const cyclic = pipelineStage("s", "S", "ingest", [
      pipelineStep("a", "A", "import", { dependsOn: ["b"] }),
      pipelineStep("b", "B", "normalize", { dependsOn: ["a"] }),
    ]);
    expect(validatePipelineStage(cyclic, 0).map((i) => i.code)).toContain("cyclic_dependencies");
  });
});

describe("definition validation", () => {
  it("accepts a complete definition", () => {
    expect(validatePipelineDefinition(makeDefinition())).toEqual([]);
  });

  it("requires stages and entities and rejects duplicates", () => {
    const codes = validatePipelineDefinition(
      makeDefinition({ stages: [], entities: [] }),
    ).map((i) => i.code);
    expect(codes).toContain("no_stages");
    expect(codes).toContain("no_entities");
  });

  it("flags duplicate stage ids and duplicate entities", () => {
    const stage = pipelineStage("dup", "Dup", "ingest", [pipelineStep("a", "A", "import")]);
    const codes = validatePipelineDefinition(
      makeDefinition({ stages: [stage, stage], entities: ["project", "project"] }),
    ).map((i) => i.code);
    expect(codes).toContain("duplicate_stage_id");
    expect(codes).toContain("duplicate_entity");
  });

  it("warns when a step touches an entity the pipeline does not declare", () => {
    const stage = pipelineStage("s", "S", "ingest", [
      pipelineStep("a", "A", "import", { entityKind: "document" }),
    ]);
    const issues = validatePipelineDefinition(
      makeDefinition({ stages: [stage], entities: ["project"] }),
    );
    const warning = issues.find((i) => i.code === "undeclared_step_entity");
    expect(warning?.severity).toBe("warning");
  });
});

describe("registry validation", () => {
  it("accepts a coherent registry", () => {
    const result = validatePipelineRegistry(makeRegistry());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a missing registry id", () => {
    const result = validatePipelineRegistry(makeRegistry({ id: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("missing_registry_id");
  });

  it("rejects duplicate pipeline ids and natural keys", () => {
    const result = validatePipelineRegistry(makeRegistry({ entries: [makeEntry(), makeEntry()] }));
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("duplicate_pipeline_id");
    expect(codes).toContain("duplicate_pipeline_key");
    expect(result.valid).toBe(false);
  });

  it("surfaces a non-boolean enabled flag as an error", () => {
    const result = validatePipelineRegistry(
      makeRegistry({ entries: [makeEntry({ enabled: "yes" as never })] }),
    );
    expect(result.errors.map((e) => e.code)).toContain("invalid_enabled_flag");
  });

  it("partitions warnings without invalidating the registry", () => {
    const stage = pipelineStage("s", "S", "ingest", [
      pipelineStep("a", "A", "import", { entityKind: "media" }),
    ]);
    const entry = makeEntry({
      definition: makeDefinition({ stages: [stage], entities: ["project"] }),
    });
    const result = validatePipelineRegistry(makeRegistry({ entries: [entry] }));
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("undeclared_step_entity");
  });
});
