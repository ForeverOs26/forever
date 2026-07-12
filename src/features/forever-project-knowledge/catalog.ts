/**
 * Project Knowledge catalog (RC5.1) — the application-facing directory of
 * every project with a stated {@link ProjectKnowledgeDefinition}.
 *
 * Each entry is a lazy loader so a project's definition (its transcribed
 * facts and sources) is only imported when that project is actually
 * inspected — the same code-splitting posture the RC5.0 route established
 * for Coralina. This module is deliberately NOT re-exported from the barrel:
 * importing the catalog means importing thunks over every known project, and
 * only the internal inspection route needs that.
 *
 * Onboarding a project = adding one entry here plus its definition module.
 * No engine code changes.
 */

import type { ProjectKnowledgeDefinition } from "./definition";
import { describeProjectKnowledgeInspection, type ProjectKnowledgeInspection } from "./inspection";
import { buildProjectKnowledgeSlice } from "./slice";

type ProjectKnowledgeLoader = () => Promise<ProjectKnowledgeDefinition>;

/** Every project with a stated knowledge definition, in intake order. */
const PROJECT_KNOWLEDGE_LOADERS: Record<string, ProjectKnowledgeLoader> = {
  coralina: async () =>
    (await import("@/features/coralina-knowledge/definition")).CORALINA_KNOWLEDGE_DEFINITION,
  modeva: async () =>
    (await import("@/features/modeva-knowledge/definition")).MODEVA_KNOWLEDGE_DEFINITION,
};

/** Slugs of every catalogued project, in intake order. */
export function listProjectKnowledgeSlugs(): string[] {
  return Object.keys(PROJECT_KNOWLEDGE_LOADERS);
}

/** Whether a knowledge definition is catalogued for the slug. */
export function hasProjectKnowledge(slug: string): boolean {
  return Object.hasOwn(PROJECT_KNOWLEDGE_LOADERS, slug);
}

// The cache holds the build PROMISE, stored synchronously before the first
// await, so concurrent first requests for one slug share a single build
// instead of racing check-then-set across the await.
const cachedInspections = new Map<string, Promise<ProjectKnowledgeInspection>>();

/**
 * The inspection view for one catalogued project, built once per process.
 * The slice is pure and deterministic, so caching is safe and keeps route
 * loads cheap. Each call returns an independent deep copy: on the server one
 * process serves many requests, and a caller mutating shared loader data in
 * place must never be able to poison the cache for every later request.
 *
 * Returns `undefined` for a slug with no catalogued definition — the caller
 * (the route) decides how to report an unknown project.
 */
export async function getProjectKnowledgeInspection(
  slug: string,
): Promise<ProjectKnowledgeInspection | undefined> {
  const loader = hasProjectKnowledge(slug) ? PROJECT_KNOWLEDGE_LOADERS[slug] : undefined;
  if (!loader) return undefined;
  let pending = cachedInspections.get(slug);
  if (!pending) {
    pending = loader().then((definition) =>
      describeProjectKnowledgeInspection(buildProjectKnowledgeSlice(definition), definition.copy),
    );
    cachedInspections.set(slug, pending);
    // A failed build must not poison the catalog forever — drop it so the
    // next request retries instead of replaying the cached rejection.
    pending.catch(() => cachedInspections.delete(slug));
  }
  return structuredClone(await pending);
}
