/**
 * Forever Project Factory (RC4.3) — shared primitive types and the reuse hub.
 *
 * RC4.2 generalized the RC4.1 Coralina proof into one canonical template that
 * describes *how a project integration package is structured*. RC4.3 adds the
 * standard engine that *generates* a package from that template: a factory is
 * the declarative description of how any Forever project package is produced
 * from the RC4.2 Project Template, given only a verified project slug and the
 * facts the project's verified data provides.
 *
 * This module is architecture only. It ships no parser, OCR, reader, scraper,
 * HTTP or API client, Supabase access, database write, queue, worker, scheduler,
 * route, React, or AI. It never reads a clock, opens a connection, holds a
 * credential, or moves a record — it *describes* deterministic project
 * generation, never a running generator.
 *
 * This file is the reuse hub. Every primitive RC4.3 needs already exists in a
 * neighbouring foundation, so RC4.3 re-exports rather than restates: identity
 * primitives come from the Forever Database (RC3.0), the entity taxonomy and
 * severity vocabulary from the Forever Import (RC3.1), and the scope, version,
 * metadata, and the whole issue/partition machinery from the Forever Project
 * Integration (RC4.0) through the Forever Project Template (RC4.2). Reusing the
 * RC4.2 identity helpers and validation pipeline is what keeps RC4.3 from ever
 * duplicating identity or validation logic.
 */

import type { ForeverId } from "@/features/forever-database";
import type { ImportSeverity, ImportSourceKind } from "@/features/forever-import";
import type {
  ProjectPackageMetadata,
  ProjectPackageScope,
  ProjectPackageVersion,
  ProjectTemplateError,
  ProjectTemplateIssue,
  ProjectTemplateWarning,
} from "@/features/forever-project-template";

/** Stable identifier for a factory. Reuses the RC3.0 id type. */
export type FactoryId = ForeverId;

/**
 * The canonical entity kinds a factory's generated packages cover.
 *
 * Reuses the Forever Import (RC3.1) kinds verbatim so a generated entity is
 * exactly an imported entity — no parallel taxonomy to drift out of sync.
 */
export type FactoryEntityKind = ImportSourceKind;

/**
 * Every {@link FactoryEntityKind}, in a stable declared order.
 *
 * RC3.1 exposes the kinds as a type only, so the list is mirrored for runtime
 * guarding and pinned to the type with `satisfies` — the compiler rejects any
 * entry that leaves the RC3.1 vocabulary (a kind *added* upstream must be
 * mirrored here by hand, as with every such mirror in the neighbouring
 * foundations).
 */
export const FACTORY_ENTITY_KINDS = [
  "project",
  "developer",
  "document",
  "media",
] as const satisfies readonly FactoryEntityKind[];

/** Runtime guard: whether a value is a known {@link FactoryEntityKind}. */
export function isKnownFactoryEntityKind(value: unknown): value is FactoryEntityKind {
  return typeof value === "string" && (FACTORY_ENTITY_KINDS as readonly string[]).includes(value);
}

/**
 * What a factory spans. Reuses the RC4.0 scope through RC4.2 so a factory
 * classifies the same way the packages it generates do.
 */
export type FactoryScope = ProjectPackageScope;

/**
 * A semantic version for a factory definition. Reuses the RC4.0 version shape
 * (through RC4.2) so factories version their descriptors exactly the way every
 * other Forever foundation versions its own.
 */
export type FactoryVersion = ProjectPackageVersion;

/** Descriptive metadata about a factory. Reuses the RC4.0 shape through RC4.2. */
export type FactoryMetadata = ProjectPackageMetadata;

/**
 * Whether an issue blocks a factory or a planned build from being treated as
 * coherent (`error`) or merely annotates it (`warning`). Reuses the RC3.1
 * severity vocabulary through RC4.0/RC4.2 so a factory issue partitions by the
 * same rule every other foundation's issues do.
 */
export type FactorySeverity = ImportSeverity;

/**
 * A single structured issue raised while describing or validating a factory,
 * recipe, stage, step, planned build, or catalogue.
 *
 * Reuses the RC4.0 issue shape (through RC4.2) so RC4.3 never restates the
 * issue vocabulary. Issues are never thrown — the foundation returns them so
 * callers decide how to react. `path` is a dotted locator into the offending
 * structure, e.g. `recipes.0.stages.2.steps.1.kind`.
 */
export type FactoryIssue = ProjectTemplateIssue;

/** A blocking issue: the factory/build must not be treated as coherent as-is. */
export type FactoryError = ProjectTemplateError;

/** A non-blocking issue: the factory/build can still be used. */
export type FactoryWarning = ProjectTemplateWarning;

// Re-export the reused constructors and value helpers under factory-facing names
// so the whole factory API is available from this one module — without ever
// re-implementing the identity or validation logic they carry. The template names
// are themselves re-exports of the RC4.0 machinery, so RC4.3 → RC4.2 → RC4.0 all
// share one implementation.
export {
  projectTemplateError as factoryError,
  projectTemplateWarning as factoryWarning,
  partitionProjectTemplateIssues as partitionFactoryIssues,
  projectPackageVersion as factoryVersion,
  formatProjectPackageVersion as formatFactoryVersion,
  compareProjectPackageVersion as compareFactoryVersion,
  PROJECT_PACKAGE_SCOPES as FACTORY_SCOPES,
  isKnownProjectPackageScope as isKnownFactoryScope,
} from "@/features/forever-project-template";
