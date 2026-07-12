/**
 * Forever Project Template (RC4.2) — shared primitive types and the reuse hub.
 *
 * RC4.1 proved the architecture by wiring one real project (Coralina) end-to-end
 * *by hand*. RC4.2 generalizes that proof into a reusable template: it describes
 * *how a project integration package is structured* so every future project can
 * be integrated by providing only verified source data, with everything else
 * following one canonical template.
 *
 * This module is architecture only. It ships no parser, OCR, reader, scraper,
 * HTTP or API client, Supabase access, database write, queue, worker, scheduler,
 * route, React, or AI. It never reads a clock, opens a connection, holds a
 * credential, or moves a record — it *describes* the shape of a package, never a
 * running integration.
 *
 * This file is the reuse hub. Every primitive RC4.2 needs already exists in a
 * neighbouring foundation, so RC4.2 re-exports rather than restates: identity
 * primitives come from the Forever Database (RC3.0), the entity taxonomy and
 * severity vocabulary from the Forever Import (RC3.1), and the scope, version,
 * metadata, and the whole issue/partition machinery from the Forever Project
 * Integration (RC4.0). Reusing RC4.0's issue constructors and partitioner is what
 * keeps RC4.2 from ever duplicating identity or validation logic.
 */

import type { ForeverId } from "@/features/forever-database";
import type { ImportSeverity, ImportSourceKind } from "@/features/forever-import";
import type {
  ProjectIntegrationError,
  ProjectIntegrationIssue,
  ProjectIntegrationMetadata,
  ProjectIntegrationScope,
  ProjectIntegrationVersion,
  ProjectIntegrationWarning,
} from "@/features/forever-project-integration";

/** Stable identifier for a project template. Reuses the RC3.0 id type. */
export type ProjectTemplateId = ForeverId;

/** Stable identifier for a project package. Reuses the RC3.0 id type. */
export type ProjectPackageId = ForeverId;

/**
 * The canonical entity kinds a package's data covers.
 *
 * Reuses the Forever Import (RC3.1) kinds verbatim so a templated entity is
 * exactly an imported entity — no parallel taxonomy to drift out of sync.
 */
export type ProjectPackageEntityKind = ImportSourceKind;

/**
 * What a package spans. Reuses the Forever Project Integration (RC4.0) scope so a
 * package classifies the same way the integration it wraps does.
 */
export type ProjectPackageScope = ProjectIntegrationScope;

/**
 * A semantic version for a template or a package. Reuses the RC4.0 version shape
 * so templates and packages version their descriptors exactly the way every
 * other Forever foundation versions its own.
 */
export type ProjectPackageVersion = ProjectIntegrationVersion;

/** Descriptive metadata about a template or a package. Reuses the RC4.0 shape. */
export type ProjectPackageMetadata = ProjectIntegrationMetadata;

/**
 * Whether an issue blocks a template/package from being treated as coherent
 * (`error`) or merely annotates it (`warning`). Reuses the RC3.1 severity
 * vocabulary through RC4.0 so a template issue partitions by the same rule every
 * other foundation's issues do.
 */
export type ProjectTemplateSeverity = ImportSeverity;

/**
 * A single structured issue raised while describing or validating a template,
 * package, layout, reference set, or catalogue.
 *
 * Reuses the RC4.0 issue shape so RC4.2 never restates the issue vocabulary.
 * Issues are never thrown — the foundation returns them so callers decide how to
 * react. `path` is a dotted locator into the offending structure, e.g.
 * `components.2.kind`.
 */
export type ProjectTemplateIssue = ProjectIntegrationIssue;

/** A blocking issue: the template/package must not be treated as coherent as-is. */
export type ProjectTemplateError = ProjectIntegrationError;

/** A non-blocking issue: the template/package can still be used. */
export type ProjectTemplateWarning = ProjectIntegrationWarning;

// Re-export the reused constructors and value helpers under template-facing names
// so the whole template API is available from this one module — without ever
// re-implementing the identity or validation logic they carry.
export {
  projectIntegrationError as projectTemplateError,
  projectIntegrationWarning as projectTemplateWarning,
  partitionProjectIntegrationIssues as partitionProjectTemplateIssues,
  projectIntegrationVersion as projectPackageVersion,
  formatProjectIntegrationVersion as formatProjectPackageVersion,
  compareProjectIntegrationVersion as compareProjectPackageVersion,
  PROJECT_INTEGRATION_SCOPES as PROJECT_PACKAGE_SCOPES,
  isKnownProjectIntegrationScope as isKnownProjectPackageScope,
} from "@/features/forever-project-integration";
