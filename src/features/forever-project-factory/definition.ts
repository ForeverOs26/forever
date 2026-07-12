/**
 * Forever Project Factory — the factory definition and the canonical factory.
 *
 * A {@link FactoryDefinition} is the complete, declarative description of one
 * factory: its identity and version, the ordered {@link FactoryRecipe}s it can
 * generate, which canonical entities its outputs cover, the optional
 * behavioural policy that governs it, and optional descriptive metadata. It is
 * the unit the registry stores and the validation pipeline judges — the
 * standard engine that builds any Forever project from the RC4.2 Project
 * Template, expressed entirely as data.
 *
 * {@link buildForeverProjectFactory} returns *the* canonical factory: one
 * recipe (the canonical Forever project recipe) generating from the canonical
 * RC4.2 template under the reused RC4.0 safe default policy. It is a pure
 * factory — it reads no clock and holds no shared state, so every call returns
 * an equal, independent value that is safe to mutate, diff, register, and
 * validate.
 */

import { deriveFactoryIdentity, factoryIdForSlug, type FactoryIdentity } from "./identity";
import { foreverProjectFactoryRecipe, type FactoryRecipe } from "./recipe";
import { defaultFactoryPolicy, type FactoryPolicy } from "./policy";
import type { FactoryEntityKind, FactoryId, FactoryMetadata, FactoryVersion } from "./types";
import { factoryVersion } from "./types";

/** The full declarative description of one factory. */
export interface FactoryDefinition {
  identity: FactoryIdentity;
  version: FactoryVersion;
  /** The ordered recipes this factory can generate; the first is its default. */
  recipes: FactoryRecipe[];
  /** Canonical entity kinds this factory's outputs cover. Reuses the RC3.1 kinds. */
  entities: FactoryEntityKind[];
  /** Optional behavioural contract governing planned builds. */
  policy?: FactoryPolicy;
  metadata?: FactoryMetadata;
}

/**
 * Identity helper that pins an object to the {@link FactoryDefinition} shape.
 *
 * Gives call sites full type-checking and inference without forcing a factory;
 * the returned value is the definition unchanged.
 */
export function defineFactory(definition: FactoryDefinition): FactoryDefinition {
  return definition;
}

/**
 * The canonical factory's stable id: `fact_forever-project`.
 *
 * Derived through the module's own {@link factoryIdForSlug} rule (never a
 * hand-written parallel form), so the constant and the derivation path can
 * never mint two different ids for the same slug.
 */
export const FOREVER_PROJECT_FACTORY_ID: FactoryId = factoryIdForSlug("forever-project");

/**
 * The canonical factory identity, derived through the module's own
 * {@link deriveFactoryIdentity} rule so it is byte-identical to what any caller
 * would derive from the canonical slug.
 */
export function foreverProjectFactoryIdentity(): FactoryIdentity {
  return deriveFactoryIdentity("forever-project", { name: "Forever Project Factory" });
}

/**
 * Build *the* canonical Forever project factory.
 *
 * Pure and deterministic: every call returns an equal, independent value with
 * no shared state, so it is always safe to mutate, diff, register, and
 * validate.
 */
export function buildForeverProjectFactory(): FactoryDefinition {
  return defineFactory({
    identity: foreverProjectFactoryIdentity(),
    version: factoryVersion(0, 1, 0),
    recipes: [foreverProjectFactoryRecipe()],
    entities: ["project", "document", "media"],
    policy: defaultFactoryPolicy(),
    metadata: {
      description:
        "Standard engine that builds any Forever project package from the canonical RC4.2 template: provide only verified source data, the factory describes everything else.",
      owner: "Forever intake",
      tags: ["factory", "rc4.3"],
    },
  });
}
