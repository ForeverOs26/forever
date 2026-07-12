import { describe, expect, it } from "vitest";

import { getCoralinaKnowledgeInspection } from "@/features/coralina-knowledge/inspection";

import {
  getProjectKnowledgeInspection,
  hasProjectKnowledge,
  listProjectKnowledgeSlugs,
} from "../catalog";

describe("project knowledge catalog", () => {
  it("catalogues both onboarded projects, in intake order", () => {
    expect(listProjectKnowledgeSlugs()).toEqual(["coralina", "modeva"]);
    expect(hasProjectKnowledge("coralina")).toBe(true);
    expect(hasProjectKnowledge("modeva")).toBe(true);
  });

  it("returns undefined for a project with no stated definition", async () => {
    expect(hasProjectKnowledge("rainpalm")).toBe(false);
    await expect(getProjectKnowledgeInspection("rainpalm")).resolves.toBeUndefined();
  });

  it("does not treat Object.prototype members as catalogued projects", async () => {
    expect(hasProjectKnowledge("toString")).toBe(false);
    await expect(getProjectKnowledgeInspection("constructor")).resolves.toBeUndefined();
  });

  it("serves the same Coralina inspection the RC5.0 accessor serves", async () => {
    const viaCatalog = await getProjectKnowledgeInspection("coralina");
    expect(viaCatalog).toEqual(getCoralinaKnowledgeInspection());
  });

  it("serves Modeva with its stated copy and blocked readiness", async () => {
    const inspection = await getProjectKnowledgeInspection("modeva");
    expect(inspection?.projectName).toBe("Modeva");
    expect(inspection?.readiness.standing).toBe("blocked");
    expect(inspection?.copy?.kicker).toBe("Internal inspection — RC5.1 project knowledge");
  });

  it("returns equal but independent snapshots — a caller cannot poison the cache", async () => {
    const first = await getProjectKnowledgeInspection("modeva");
    const second = await getProjectKnowledgeInspection("modeva");
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    first!.facts.pop();
    await expect(getProjectKnowledgeInspection("modeva")).resolves.toEqual(second);
  });
});
