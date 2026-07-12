/**
 * Forever Project Sources — deterministic, immutable helpers.
 *
 * Pure, side-effect-free utilities shared across the foundation: stable
 * natural keys for identities, documents, and definitions, a stable
 * version-order sort, and distinct collectors over the module's vocabularies.
 * Given the same input they always return the same output — no randomness, no
 * clocks, no locale — so the whole module stays deterministic and these
 * helpers never need re-implementing per call site.
 *
 * The string guard is reused verbatim from the Forever Source Registry (RC3.3)
 * helpers rather than restated, so RC4.4 shares one definition of "non-empty
 * string" with the source-system machinery it also reuses.
 */

import { isNonEmptyString } from "@/features/forever-source-registry";

import type { ProjectSourceDefinition } from "./definition";
import type { ProjectSourceDocumentType, ProjectSourceFileFormat } from "./descriptor";
import type { ProjectSourceIdentity } from "./identity";
import { compareProjectSourceVersion, formatProjectSourceVersion } from "./version";

export { isNonEmptyString };

/**
 * True when a value is absent: `null` or `undefined`.
 *
 * The validation pipeline treats both spellings of "no value" identically so
 * it can keep its never-throws promise over arbitrarily malformed input —
 * absence is reported, never dereferenced.
 */
export function isAbsent(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Stable key for a source identity, independent of its surrogate id:
 * `projectId:slug`. Every received revision of the same document shares this
 * key — it is the *document* key the registry groups versions by.
 */
export function projectSourceDocumentKey(identity: ProjectSourceIdentity): string {
  return `${identity.projectId}:${identity.slug}`;
}

/**
 * Stable natural key for one catalogued revision:
 * `projectId:slug@major.minor.patch`. Two definitions share a key only when
 * they describe the same revision of the same document.
 */
export function projectSourceDefinitionKey(definition: ProjectSourceDefinition): string {
  return `${projectSourceDocumentKey(definition.identity)}@${formatProjectSourceVersion(
    definition.version,
  )}`;
}

/**
 * A copy of the definitions ordered oldest revision first.
 *
 * Stable and immutable: equal versions keep their input order and the input
 * list is never mutated.
 */
export function sortProjectSourcesByVersion(
  definitions: readonly ProjectSourceDefinition[],
): ProjectSourceDefinition[] {
  return [...definitions].sort((a, b) => compareProjectSourceVersion(a.version, b.version));
}

/** The distinct document types across definitions, in first-seen order. */
export function distinctProjectSourceDocumentTypes(
  definitions: readonly ProjectSourceDefinition[],
): ProjectSourceDocumentType[] {
  const seen = new Set<ProjectSourceDocumentType>();
  const types: ProjectSourceDocumentType[] = [];
  for (const definition of definitions) {
    if (!seen.has(definition.descriptor.documentType)) {
      seen.add(definition.descriptor.documentType);
      types.push(definition.descriptor.documentType);
    }
  }
  return types;
}

/** The distinct file formats across definitions, in first-seen order. */
export function distinctProjectSourceFileFormats(
  definitions: readonly ProjectSourceDefinition[],
): ProjectSourceFileFormat[] {
  const seen = new Set<ProjectSourceFileFormat>();
  const formats: ProjectSourceFileFormat[] = [];
  for (const definition of definitions) {
    if (!seen.has(definition.descriptor.fileFormat)) {
      seen.add(definition.descriptor.fileFormat);
      formats.push(definition.descriptor.fileFormat);
    }
  }
  return formats;
}

/** The distinct languages declared across definitions, in first-seen order. */
export function distinctProjectSourceLanguages(
  definitions: readonly ProjectSourceDefinition[],
): string[] {
  const seen = new Set<string>();
  const languages: string[] = [];
  for (const definition of definitions) {
    const language = definition.descriptor.language;
    if (language !== undefined && !seen.has(language)) {
      seen.add(language);
      languages.push(language);
    }
  }
  return languages;
}

/** The distinct metadata tags across definitions, in first-seen order. */
export function distinctProjectSourceTags(
  definitions: readonly ProjectSourceDefinition[],
): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const definition of definitions) {
    for (const tag of definition.metadata?.tags ?? []) {
      if (!seen.has(tag)) {
        seen.add(tag);
        tags.push(tag);
      }
    }
  }
  return tags;
}

/** The distinct project ids the definitions belong to, in first-seen order. */
export function distinctProjectSourceProjects(
  definitions: readonly ProjectSourceDefinition[],
): string[] {
  const seen = new Set<string>();
  const projects: string[] = [];
  for (const definition of definitions) {
    if (!seen.has(definition.identity.projectId)) {
      seen.add(definition.identity.projectId);
      projects.push(definition.identity.projectId);
    }
  }
  return projects;
}
