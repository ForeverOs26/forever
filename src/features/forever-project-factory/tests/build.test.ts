import { describe, expect, it } from "vitest";

import {
  FOREVER_PROJECT_TEMPLATE_ID,
  buildProjectPackage,
  requiredProjectComponentKinds,
} from "@/features/forever-project-template";

import {
  FOREVER_PROJECT_FACTORY_ID,
  FOREVER_PROJECT_RECIPE_ID,
  factoryBuildHistoryEntry,
  planFactoryBuild,
} from "..";
import { makeContext, makeFactory, makeRequest } from "./fixtures";

describe("planFactoryBuild", () => {
  it("describes a build whose ids and root follow the reused RC4.2 conventions", () => {
    const result = planFactoryBuild(makeContext(), makeRequest({ slug: "Villa Coralina" }));
    const build = result.data[0];
    expect(build.id).toBe("build_villa-coralina");
    expect(build.factoryId).toBe(FOREVER_PROJECT_FACTORY_ID);
    expect(build.recipeId).toBe(FOREVER_PROJECT_RECIPE_ID);
    expect(build.package.identity.id).toBe("pkg_villa-coralina");
    expect(build.package.projectId).toBe("proj_villa-coralina");
    expect(build.root).toBe("src/features/villa-coralina-integration");
  });

  it("settles a clean plan as succeeded with every step completed", () => {
    const result = planFactoryBuild(makeContext(), makeRequest());
    expect(result.ok).toBe(true);
    expect(result.state).toBe("succeeded");
    expect(result.outcome).toBe("success");
    expect(result.stats).toEqual({
      stages: 4,
      steps: 8,
      completed: 8,
      skipped: 0,
      failed: 0,
      warnings: 0,
      errors: 0,
    });
  });

  it("defaults the package through the reused RC4.2 builder, never a local variant", () => {
    const build = planFactoryBuild(makeContext(), makeRequest()).data[0];
    expect(build.package.provides).toEqual(requiredProjectComponentKinds(build.template));
    expect(build.package.entities).toEqual(["project"]);
    expect(build.package).toEqual(
      buildProjectPackage("coralina", {
        name: "Coralina",
        templateId: FOREVER_PROJECT_TEMPLATE_ID,
        provides: requiredProjectComponentKinds(build.template),
        entities: ["project"],
      }),
    );
  });

  it("honours the request's verified facts over the defaults", () => {
    const result = planFactoryBuild(
      makeContext(),
      makeRequest({
        scope: "portfolio",
        provides: ["identity", "sources"],
        entities: ["project", "document"],
      }),
    );
    const pkg = result.data[0].package;
    expect(pkg.identity.scope).toBe("portfolio");
    expect(pkg.provides).toEqual(["identity", "sources"]);
    expect(pkg.entities).toEqual(["project", "document"]);
  });

  it("reports an unknown recipe or a recipe-less factory as a blocking issue with an empty plan", () => {
    const result = planFactoryBuild(makeContext(), makeRequest({ recipeId: "nope" }));
    expect(result.ok).toBe(false);
    expect(result.state).toBe("failed");
    expect(result.data).toEqual([]);
    expect(result.errors.map((error) => error.code)).toEqual(["unknown_recipe"]);
    expect(result.stats.steps).toBe(0);

    const context = makeContext({ definition: makeFactory({ recipes: [] }) });
    const bare = planFactoryBuild(context, makeRequest());
    expect(bare.ok).toBe(false);
    expect(bare.errors.map((error) => error.code)).toEqual(["unknown_recipe"]);
  });

  it("fails the verify steps when the described package violates the reused RC4.2 contract", () => {
    const result = planFactoryBuild(makeContext(), makeRequest({ provides: ["identity"] }));
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("missing_required_component");
    expect(result.stats.failed).toBe(1);
    expect(result.stats.completed).toBe(7);
    expect(result.state).toBe("partial");
    expect(result.data).toHaveLength(1);
  });

  it("stamps provenance only from the caller-supplied clock", () => {
    const dated = planFactoryBuild(makeContext({ now: "2026-07-12T00:00:00.000Z" }), makeRequest());
    expect(dated.metadata.plannedAt).toBe("2026-07-12T00:00:00.000Z");

    const undated = planFactoryBuild(makeContext(), makeRequest());
    expect("plannedAt" in undated.metadata).toBe(false);
    expect(undated.metadata).toEqual({
      factoryId: FOREVER_PROJECT_FACTORY_ID,
      recipeId: FOREVER_PROJECT_RECIPE_ID,
      projectSlug: "coralina",
      stageCount: 4,
      stepCount: 8,
      entityCount: 1,
    });
  });

  it("derives a history entry from a settled plan", () => {
    const result = planFactoryBuild(makeContext(), makeRequest());
    const entry = factoryBuildHistoryEntry(result, { finishedAt: "2026-07-12T00:00:00.000Z" });
    expect(entry).toEqual({
      factoryId: FOREVER_PROJECT_FACTORY_ID,
      buildId: "build_coralina",
      recipeId: FOREVER_PROJECT_RECIPE_ID,
      state: "succeeded",
      outcome: "success",
      finishedAt: "2026-07-12T00:00:00.000Z",
      stats: result.stats,
    });

    const blocked = factoryBuildHistoryEntry(
      planFactoryBuild(makeContext(), makeRequest({ recipeId: "nope" })),
    );
    expect("buildId" in blocked).toBe(false);
    expect("recipeId" in blocked).toBe(false);
    expect("startedAt" in blocked).toBe(false);
  });
});
