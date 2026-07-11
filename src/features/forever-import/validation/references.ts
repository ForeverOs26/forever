/**
 * Forever Import — referential integrity.
 *
 * Confirms that every foreign key in a batch resolves to a known id — either an
 * entity in the same batch or one supplied via {@link ReferenceScope} (already
 * in the database). An unresolved reference is a blocking error: persisting it
 * would create an orphan.
 */

import { importError } from "../result";
import type { ImportIssue } from "../types";
import type { ImportBatch, ReferenceScope } from "./batch";

function idSet(
  ids: readonly { id: string }[] | undefined,
  scope?: ReadonlySet<string>,
): Set<string> {
  const set = new Set<string>(scope);
  for (const entity of ids ?? []) set.add(entity.id);
  return set;
}

/**
 * Validate every foreign key in the batch against the resolvable id universe.
 *
 * The universe is the union of the batch's own ids and {@link ReferenceScope}.
 * Optional foreign keys (`developerId`, `locationId`, a unit-scoped ref) are
 * only checked when present; a missing optional key is not an error.
 */
export function validateReferences(batch: ImportBatch, scope: ReferenceScope = {}): ImportIssue[] {
  const issues: ImportIssue[] = [];

  const developerIds = idSet(batch.developers, scope.developerIds);
  const projectIds = idSet(batch.projects, scope.projectIds);
  const locationIds = new Set<string>(scope.locationIds);

  const checkRef = (
    known: ReadonlySet<string>,
    collection: string,
    index: number,
    field: string,
    value: string,
    kind: string,
  ) => {
    if (!known.has(value)) {
      issues.push(
        importError(
          "unresolved_reference",
          `${collection}.${field} "${value}" does not resolve to a known ${kind}`,
          `${collection}.${index}.${field}`,
        ),
      );
    }
  };

  (batch.projects ?? []).forEach((project, index) => {
    if (project.developerId !== undefined) {
      checkRef(developerIds, "projects", index, "developerId", project.developerId, "developer");
    }
    if (project.locationId !== undefined) {
      checkRef(locationIds, "projects", index, "locationId", project.locationId, "location");
    }
  });

  (batch.units ?? []).forEach((unit, index) => {
    checkRef(projectIds, "units", index, "projectId", unit.projectId, "project");
  });

  (batch.media ?? []).forEach((media, index) => {
    checkRef(projectIds, "media", index, "projectId", media.projectId, "project");
  });

  (batch.documents ?? []).forEach((document, index) => {
    checkRef(projectIds, "documents", index, "projectId", document.projectId, "project");
  });

  return issues;
}
