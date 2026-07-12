/**
 * Forever Project Template — the template descriptor and the canonical template.
 *
 * A {@link ProjectTemplate} is the complete, declarative description of how a
 * project integration package is structured: the ordered {@link ProjectComponent}s
 * a conforming package is composed of, the {@link ProjectLayout} it follows, and
 * the {@link ProjectReference} contract it must resolve. It is the single
 * canonical answer to "how is a project integrated?", generalized from the
 * Coralina slice so future projects need only supply verified source data.
 *
 * {@link buildForeverProjectTemplate} returns *the* canonical template. It is a
 * pure factory — it reads no clock and holds no shared state, so every call
 * returns an equal, independent value that is safe to mutate, diff, and validate.
 * The template describes structure only; it never instantiates a package's data.
 */

import {
  projectComponent,
  type ProjectComponent,
  type ProjectComponentKind,
} from "./component";
import { projectLayout, projectLayoutNode, type ProjectLayout } from "./layout";
import { projectReference, type ProjectReference } from "./reference";
import type { ProjectTemplateIdentity } from "./identity";
import type { ProjectPackageMetadata, ProjectPackageVersion, ProjectTemplateId } from "./types";
import { projectPackageVersion } from "./types";

/** The full declarative description of how a project package is structured. */
export interface ProjectTemplate {
  identity: ProjectTemplateIdentity;
  version: ProjectPackageVersion;
  /** The ordered components a conforming package is composed of. */
  components: ProjectComponent[];
  /** The canonical module structure a conforming package follows. */
  layout: ProjectLayout;
  /** The cross-foundation references a conforming package must resolve. */
  references: ProjectReference[];
  metadata?: ProjectPackageMetadata;
}

/**
 * Identity helper that pins an object to the {@link ProjectTemplate} shape.
 *
 * Gives call sites full type-checking and inference without forcing a factory;
 * the returned value is the template unchanged.
 */
export function defineProjectTemplate(template: ProjectTemplate): ProjectTemplate {
  return template;
}

/** The canonical template's stable id. */
export const FOREVER_PROJECT_TEMPLATE_ID: ProjectTemplateId = "tmpl_forever_project";

/** The canonical components every Forever project package is composed of. */
export function foreverProjectComponents(): ProjectComponent[] {
  return [
    projectComponent("identity", "Canonical identity", "rc3.0", true, {
      entities: ["project"],
      description: "Deterministic ids and slugs derived from the verified project slug.",
    }),
    projectComponent("sources", "Source definitions", "rc3.3", true, {
      entities: ["project", "document", "media"],
      description: "One registered source per verified source artifact the project provides.",
    }),
    projectComponent("connector", "Transport connector", "rc3.4", false, {
      description: "Optional connector; a manual file package may bind its sources directly.",
    }),
    projectComponent("pipeline", "Import pipeline", "rc3.5", true, {
      entities: ["project"],
      description: "The pipeline that shapes verified sources into canonical records.",
    }),
    projectComponent("canonical", "Canonical record", "rc3.0", true, {
      entities: ["project", "document", "media"],
      description: "The Forever Database record the package's data maps to.",
    }),
    projectComponent("integration", "Integration definition", "rc4.0", true, {
      entities: ["project"],
      description: "The RC4.0 definition that wires sources, connector, and pipeline together.",
    }),
    projectComponent("references", "Reference resolution", "rc4.0", true, {
      description: "Resolution of every cross-foundation id the integration makes.",
    }),
    projectComponent("verification", "Verification result", "rc4.1", true, {
      entities: ["project"],
      description: "Deterministic data-readiness verification of the assembled package.",
    }),
  ];
}

/** The canonical module layout every Forever project package follows. */
export function foreverProjectLayout(): ProjectLayout {
  return projectLayout("src/features/{slug}-integration", [
    projectLayoutNode("index.ts", "module", {
      description: "Barrel export for the whole package.",
    }),
    projectLayoutNode("identity.ts", "module", {
      component: "identity",
      description: "Deterministic ids and slugs.",
    }),
    projectLayoutNode("data", "directory", {
      description: "Verified facts the project provides.",
      children: [
        projectLayoutNode("data/index.ts", "module", {
          description: "Barrel export for the verified facts.",
        }),
      ],
    }),
    projectLayoutNode("sources", "directory", {
      component: "sources",
      description: "Source definitions (RC3.3).",
      children: [
        projectLayoutNode("sources/index.ts", "module", { component: "sources" }),
      ],
    }),
    projectLayoutNode("adapters", "directory", {
      component: "canonical",
      description: "Adapters mapping verified facts to canonical records (RC3.0/3.1).",
      children: [
        projectLayoutNode("adapters/index.ts", "module", { component: "canonical" }),
      ],
    }),
    projectLayoutNode("integration", "directory", {
      component: "integration",
      description: "Connector, pipeline, and integration definitions (RC3.4/3.5/4.0).",
      children: [
        projectLayoutNode("integration/connector.ts", "module", { component: "connector" }),
        projectLayoutNode("integration/pipeline.ts", "module", { component: "pipeline" }),
        projectLayoutNode("integration/integration.ts", "module", { component: "integration" }),
      ],
    }),
    projectLayoutNode("validation", "directory", {
      component: "verification",
      description: "Reference resolution and verification (RC4.0 boundary / RC4.1).",
      children: [
        projectLayoutNode("validation/references.ts", "module", { component: "references" }),
        projectLayoutNode("validation/verification.ts", "module", { component: "verification" }),
      ],
    }),
  ]);
}

/**
 * The canonical cross-foundation reference contract every package must resolve.
 *
 * The `required: false` references (a developer, documents, media, a dedicated
 * connector's bound source) are expected only when their optional data is
 * present — encoding the anti-fabrication rule directly into the contract.
 */
export function foreverProjectReferences(): ProjectReference[] {
  return [
    projectReference("integration-source", "integration", "sources", true, {
      description: "Every source the integration names resolves in the source registry.",
    }),
    projectReference("integration-pipeline", "integration", "pipeline", true, {
      description: "Every pipeline the integration names resolves in the pipeline registry.",
    }),
    projectReference("integration-connector", "integration", "connector", false, {
      description: "A referenced connector resolves — only when the package has one.",
    }),
    projectReference("pipeline-source", "pipeline", "sources", true, {
      description: "Every source the pipeline reads resolves in the source registry.",
    }),
    projectReference("pipeline-connector", "pipeline", "connector", false, {
      description: "A pipeline's connector resolves — only when the package has one.",
    }),
    projectReference("connector-source", "connector", "sources", false, {
      description: "A connector's bound source resolves — only when the package has a connector.",
    }),
    projectReference("project-location", "canonical", "canonical", true, {
      description: "The project's locationId resolves to its location record.",
    }),
    projectReference("project-developer", "canonical", "canonical", false, {
      description: "The project's developerId resolves — only when a verified developer exists.",
    }),
    projectReference("unit-project", "canonical", "canonical", true, {
      description: "Every unit references the package's project.",
    }),
    projectReference("document-project", "canonical", "canonical", false, {
      description: "Every document references the project — only when documents exist.",
    }),
    projectReference("media-project", "canonical", "canonical", false, {
      description: "Every media asset references the project — only when media exist.",
    }),
    projectReference("canonical-integrity", "canonical", "canonical", true, {
      description: "The whole record passes RC3.0 referential integrity.",
    }),
  ];
}

/** The canonical template identity. */
export function foreverProjectTemplateIdentity(): ProjectTemplateIdentity {
  return {
    id: FOREVER_PROJECT_TEMPLATE_ID,
    slug: "forever-project",
    name: "Forever Project Template",
  };
}

/**
 * Build *the* canonical Forever project template.
 *
 * Pure and deterministic: every call returns an equal, independent value with no
 * shared state, so it is always safe to mutate, diff, register, and validate.
 */
export function buildForeverProjectTemplate(): ProjectTemplate {
  return defineProjectTemplate({
    identity: foreverProjectTemplateIdentity(),
    version: projectPackageVersion(0, 1, 0),
    components: foreverProjectComponents(),
    layout: foreverProjectLayout(),
    references: foreverProjectReferences(),
    metadata: {
      description:
        "Canonical structure of a Forever project integration package: provide verified source data, follow the template for everything else.",
      owner: "Forever intake",
      tags: ["template", "rc4.2"],
    },
  });
}

/** The distinct component kinds the canonical template requires, in declared order. */
export function requiredProjectComponentKinds(template: ProjectTemplate): ProjectComponentKind[] {
  return template.components.filter((c) => c.required).map((c) => c.kind);
}
