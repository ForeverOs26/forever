/**
 * Forever Import — the validation pipeline.
 *
 * Composes the individual guards (entity ids, duplicate detection, referential
 * integrity) into one deterministic pass over an {@link ImportBatch}. This is
 * the single entry point a source or adapter calls before declaring records
 * safe to persist. It never throws — it returns a structured verdict.
 */

import { foreverDatabaseEntities } from "@/features/forever-database";

import { partitionIssues } from "../result";
import type { ImportError, ImportIssue, ImportWarning } from "../types";
import type { ImportBatch, ReferenceScope } from "./batch";
import { validateDuplicateEntities } from "./duplicates";
import { validateEntityIds } from "./fields";
import { validateReferences } from "./references";

/** The structured verdict of {@link validateImport}. */
export interface ImportValidation {
  valid: boolean;
  issues: ImportIssue[];
  errors: ImportError[];
  warnings: ImportWarning[];
}

interface CollectionCheck {
  readonly label: keyof ImportBatch;
  readonly entities: readonly { id: unknown }[] | undefined;
  readonly descriptor: (typeof foreverDatabaseEntities)[keyof typeof foreverDatabaseEntities];
}

/**
 * Run the full validation suite over a batch.
 *
 * Per collection it checks id validity/uniqueness and natural-key duplicates;
 * across the batch it checks referential integrity against {@link scope}.
 * Issues from every check are merged in a stable order.
 */
export function validateImport(batch: ImportBatch, scope: ReferenceScope = {}): ImportValidation {
  const issues: ImportIssue[] = [];

  const checks: CollectionCheck[] = [
    {
      label: "developers",
      entities: batch.developers,
      descriptor: foreverDatabaseEntities.developer,
    },
    { label: "projects", entities: batch.projects, descriptor: foreverDatabaseEntities.project },
    { label: "units", entities: batch.units, descriptor: foreverDatabaseEntities.unit },
    { label: "media", entities: batch.media, descriptor: foreverDatabaseEntities.media },
    { label: "documents", entities: batch.documents, descriptor: foreverDatabaseEntities.document },
  ];

  for (const check of checks) {
    if (!check.entities) continue;
    issues.push(...validateEntityIds(check.entities, check.label));
    issues.push(
      // The descriptor's identity matches the collection's element type by
      // construction; the registry is keyed to the same canonical models.
      ...validateDuplicateEntities(check.entities as never, check.descriptor as never, check.label),
    );
  }

  issues.push(...validateReferences(batch, scope));

  const { errors, warnings } = partitionIssues(issues);
  return { valid: errors.length === 0, issues, errors, warnings };
}
