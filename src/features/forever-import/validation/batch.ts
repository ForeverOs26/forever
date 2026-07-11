/**
 * Forever Import — validation batch shapes.
 *
 * An import run is validated as a *batch* of canonical entities keyed by kind.
 * Keeping the batch loose (every collection optional) lets a single-kind source
 * — say a {@link MediaImportSource} — be validated in isolation while a
 * multi-kind run validates everything together.
 */

import type {
  ForeverDeveloper,
  ForeverDocument,
  ForeverMedia,
  ForeverProject,
  ForeverUnit,
} from "@/features/forever-database";

/** Canonical entities produced by one or more import sources, grouped by kind. */
export interface ImportBatch {
  developers?: ForeverDeveloper[];
  projects?: ForeverProject[];
  units?: ForeverUnit[];
  media?: ForeverMedia[];
  documents?: ForeverDocument[];
}

/**
 * Ids already known outside the batch (e.g. entities already in the database).
 *
 * Reference validation resolves foreign keys against the union of the batch's
 * own ids and this scope, so importing a document that points at an existing
 * project succeeds without re-importing the project.
 */
export interface ReferenceScope {
  developerIds?: ReadonlySet<string>;
  locationIds?: ReadonlySet<string>;
  projectIds?: ReadonlySet<string>;
  unitIds?: ReadonlySet<string>;
}
