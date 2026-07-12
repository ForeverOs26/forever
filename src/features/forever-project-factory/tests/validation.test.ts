import { describe, expect, it } from "vitest";

import {
  buildForeverProjectFactory,
  deriveFactoryIdentity,
  factoryRecipe,
  factoryStage,
  factoryStep,
  foreverProjectFactoryRecipe,
  partitionFactoryIssues,
  validateFactoryCatalog,
  validateFactoryDefinition,
  validateFactoryIdentity,
  validateFactoryRecipe,
  validateFactoryStage,
  validateFactoryStep,
} from "..";
import { makeCatalog, makeEntry, makeFactory } from "./fixtures";

describe("identity validation", () => {
  it("passes a derived identity; flags missing fields and an unknown scope; warns (never rewrites) on an unnormalized slug", () => {
    expect(validateFactoryIdentity(deriveFactoryIdentity("coralina"))).toEqual([]);

    const codes = validateFactoryIdentity({
      id: "",
      slug: "",
      name: "",
      scope: "galaxy" as never,
    }).map((issue) => issue.code);
    expect(codes).toEqual([
      "missing_factory_id",
      "missing_factory_slug",
      "missing_factory_name",
      "unknown_factory_scope",
    ]);

    const unnormalized = validateFactoryIdentity({
      id: "fact_x",
      slug: "Not Normal",
      name: "X",
      scope: "project",
    });
    expect(unnormalized).toHaveLength(1);
    expect(unnormalized[0].code).toBe("unnormalized_factory_slug");
    expect(unnormalized[0].severity).toBe("warning");
  });
});

describe("step and stage validation", () => {
  it("flags an unknown step kind, unknown/duplicate components, and an unknown entity", () => {
    const step = factoryStep("x", "X", "scaffold" as never, {
      components: ["identity", "identity", "bogus" as never],
      entityKind: "galaxy" as never,
    });
    const codes = validateFactoryStep(step, "steps.0").map((issue) => issue.code);
    expect(codes).toContain("unknown_step_kind");
    expect(codes).toContain("duplicate_step_component");
    expect(codes).toContain("unknown_step_component");
    expect(codes).toContain("unknown_step_entity");
  });

  it("flags an empty stage, a duplicate step id, and an unknown stage kind", () => {
    const empty = factoryStage("s", "S", "launch" as never, []);
    const emptyCodes = validateFactoryStage(empty, "stages.0").map((issue) => issue.code);
    expect(emptyCodes).toContain("empty_stage");
    expect(emptyCodes).toContain("unknown_stage_kind");

    const dupes = factoryStage("s", "S", "prepare", [
      factoryStep("a", "A", "identity"),
      factoryStep("a", "A again", "identity"),
    ]);
    expect(validateFactoryStage(dupes, "stages.0").map((issue) => issue.code)).toContain(
      "duplicate_step_id",
    );
  });
});

describe("recipe validation", () => {
  it("passes the canonical recipe with no issues at all", () => {
    expect(validateFactoryRecipe(foreverProjectFactoryRecipe())).toEqual([]);
  });

  it("flags a missing template, no stages, and duplicate stage ids", () => {
    const bare = factoryRecipe("", "", "", []);
    const bareCodes = validateFactoryRecipe(bare).map((issue) => issue.code);
    expect(bareCodes).toContain("missing_recipe_id");
    expect(bareCodes).toContain("missing_recipe_name");
    expect(bareCodes).toContain("missing_recipe_template");
    expect(bareCodes).toContain("no_stages");

    const stage = factoryStage("only", "Only", "prepare", [factoryStep("a", "A", "identity")]);
    const dupes = factoryRecipe("r", "R", "tmpl_x", [stage, { ...stage }]);
    expect(validateFactoryRecipe(dupes).map((issue) => issue.code)).toContain("duplicate_stage_id");
  });

  it("warns on a recipe that never verifies and flags bad default entities", () => {
    const stage = factoryStage("prepare", "Prepare", "prepare", [
      factoryStep("a", "A", "identity"),
    ]);
    const recipe = factoryRecipe("r", "R", "tmpl_x", [stage], {
      entities: ["project", "project", "galaxy" as never],
    });
    const issues = validateFactoryRecipe(recipe);
    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain("duplicate_recipe_entity");
    expect(codes).toContain("unknown_recipe_entity");
    expect(issues.find((issue) => issue.code === "no_verify_stage")?.severity).toBe("warning");
  });
});

describe("definition validation", () => {
  it("passes the canonical factory with no errors", () => {
    const { errors } = partitionFactoryIssues(
      validateFactoryDefinition(buildForeverProjectFactory()),
    );
    expect(errors).toEqual([]);
  });

  it("flags no recipes, duplicate recipe ids, missing version, and bad entities", () => {
    const none = makeFactory({ recipes: [], version: undefined as never, entities: [] });
    const noneCodes = validateFactoryDefinition(none).map((issue) => issue.code);
    expect(noneCodes).toContain("no_recipes");
    expect(noneCodes).toContain("missing_factory_version");
    expect(noneCodes).toContain("no_entities");

    const dupes = makeFactory({
      recipes: [foreverProjectFactoryRecipe(), foreverProjectFactoryRecipe()],
      entities: ["project", "project", "galaxy" as never],
    });
    const dupeCodes = validateFactoryDefinition(dupes).map((issue) => issue.code);
    expect(dupeCodes).toContain("duplicate_recipe_id");
    expect(dupeCodes).toContain("duplicate_entity");
    expect(dupeCodes).toContain("unknown_entity");
  });

  it("warns when a recipe or step names an entity the factory does not cover", () => {
    const factory = makeFactory({ entities: ["document"] });
    const issues = validateFactoryDefinition(factory);
    const recipeWarning = issues.find((issue) => issue.code === "undeclared_recipe_entity");
    const stepWarning = issues.find((issue) => issue.code === "undeclared_step_entity");
    expect(recipeWarning?.severity).toBe("warning");
    expect(stepWarning?.severity).toBe("warning");
  });

  it("surfaces reused RC4.0 policy issues through the definition guard", () => {
    const factory = makeFactory({
      policy: {
        id: "p",
        executionMode: "warp" as never,
        onError: "abort",
        retry: { maxAttempts: 0, backoff: "none" },
        dryRunOnly: true,
      },
    });
    const codes = validateFactoryDefinition(factory).map((issue) => issue.code);
    expect(codes).toContain("unknown_execution_mode");
    expect(codes).toContain("invalid_retry_attempts");
  });
});

describe("catalogue validation", () => {
  it("passes a coherent catalogue", () => {
    expect(validateFactoryCatalog(makeCatalog()).valid).toBe(true);
  });

  it("flags a missing id, duplicate ids/keys, and a non-boolean enabled flag", () => {
    expect(validateFactoryCatalog(makeCatalog({ id: "" })).errors.map((e) => e.code)).toContain(
      "missing_catalog_id",
    );

    const dupes = validateFactoryCatalog(makeCatalog({ entries: [makeEntry(), makeEntry()] }));
    const dupeCodes = dupes.errors.map((error) => error.code);
    expect(dupeCodes).toContain("duplicate_factory_id");
    expect(dupeCodes).toContain("duplicate_factory_key");

    const badFlag = makeCatalog({ entries: [makeEntry({ enabled: "yes" as never })] });
    expect(validateFactoryCatalog(badFlag).errors.map((error) => error.code)).toContain(
      "invalid_enabled_flag",
    );
  });

  it("never throws on deeply malformed input", () => {
    const broken = {
      id: undefined,
      entries: [
        {
          enabled: null,
          definition: { identity: {}, recipes: null, entities: undefined },
        },
      ],
    } as never;
    expect(() => validateFactoryCatalog(broken)).not.toThrow();
    expect(validateFactoryCatalog(broken).valid).toBe(false);
  });
});
