/**
 * Forever Project Template — the project package descriptor.
 *
 * A {@link ProjectPackage} is one concrete project's declaration that it conforms
 * to a {@link import("./template").ProjectTemplate}: its identity, the template it
 * follows, which {@link ProjectComponentKind}s it provides, and the canonical
 * entity kinds its verified data covers. It is the generalized, declarative stand
 * in for a whole `{slug}-integration/` module — what Coralina *is*, expressed as a
 * descriptor rather than a folder of code.
 *
 * A package carries no source data, no live definition, and no record — it
 * *names* what it provides so the template's contract can be checked against it.
 * Building one from a verified slug is the one thing a future project must do; the
 * builder attaches only what it is given, so an absent fact stays absent.
 */

import type { ProjectComponentKind } from "./component";
import {
  deriveProjectPackageIdentity,
  projectCanonicalId,
  type ProjectPackageIdentity,
} from "./identity";
import type { ProjectLayout } from "./layout";
import { FOREVER_PROJECT_TEMPLATE_ID } from "./template";
import type {
  ProjectPackageEntityKind,
  ProjectPackageMetadata,
  ProjectPackageVersion,
  ProjectTemplateId,
} from "./types";
import { projectPackageVersion } from "./types";

/** One concrete project's declaration of the package it provides. */
export interface ProjectPackage {
  identity: ProjectPackageIdentity;
  /** The template this package conforms to. */
  templateId: ProjectTemplateId;
  version: ProjectPackageVersion;
  /** The component kinds this package provides. */
  provides: ProjectComponentKind[];
  /** Canonical entity kinds the package's verified data covers. Reuses the RC3.1 kinds. */
  entities: ProjectPackageEntityKind[];
  /** The canonical project this package targets. Reuses the RC3.0 id convention. */
  projectId?: string;
  /** An optional layout override; a package that omits it follows the template's. */
  layout?: ProjectLayout;
  metadata?: ProjectPackageMetadata;
}

/**
 * Identity helper that pins an object to the {@link ProjectPackage} shape.
 *
 * Gives call sites full type-checking and inference without forcing a factory;
 * the returned value is the package unchanged.
 */
export function defineProjectPackage(pkg: ProjectPackage): ProjectPackage {
  return pkg;
}

/** Options accepted by {@link buildProjectPackage}. */
export interface BuildProjectPackageOptions {
  /** Display name; defaults to the normalized slug. */
  name?: string;
  /** What the package spans; defaults to `project`. */
  scope?: ProjectPackageIdentity["scope"];
  /** The template this package conforms to; defaults to the canonical template. */
  templateId?: ProjectTemplateId;
  /** Package version; defaults to `0.1.0`. */
  version?: ProjectPackageVersion;
  /** Component kinds provided; defaults to an empty list (a package provides nothing until it declares it). */
  provides?: ProjectComponentKind[];
  /** Entity kinds the verified data covers; defaults to an empty list. */
  entities?: ProjectPackageEntityKind[];
  layout?: ProjectLayout;
  metadata?: ProjectPackageMetadata;
}

/**
 * Build a {@link ProjectPackage} from a project's verified slug.
 *
 * Deterministic: the same slug and options always yield an equal package. The
 * canonical project id is derived from the slug (never fabricated), and optional
 * facts are attached only when supplied so an absent fact stays absent.
 */
export function buildProjectPackage(
  slug: string,
  options: BuildProjectPackageOptions = {},
): ProjectPackage {
  const identity = deriveProjectPackageIdentity(slug, {
    name: options.name,
    scope: options.scope,
  });
  const pkg: ProjectPackage = {
    identity,
    templateId: options.templateId ?? FOREVER_PROJECT_TEMPLATE_ID,
    version: options.version ?? projectPackageVersion(0, 1, 0),
    provides: options.provides ?? [],
    entities: options.entities ?? [],
    projectId: projectCanonicalId(identity.slug),
  };
  if (options.layout !== undefined) pkg.layout = options.layout;
  if (options.metadata !== undefined) pkg.metadata = options.metadata;
  return pkg;
}

/** Whether a package declares that it provides the given component kind. */
export function projectPackageProvidesComponent(
  pkg: ProjectPackage,
  kind: ProjectComponentKind,
): boolean {
  return pkg.provides.includes(kind);
}

/** Whether a package declares that its data covers the given entity kind. */
export function projectPackageCoversEntity(
  pkg: ProjectPackage,
  kind: ProjectPackageEntityKind,
): boolean {
  return pkg.entities.includes(kind);
}
