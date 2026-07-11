/**
 * Forever Import — duplicate entity detection.
 *
 * Reuses the Forever Database entity descriptors (RC3.0) so import validation
 * shares the exact same notion of real-world identity the database enforces. A
 * batch that contains two records for the same real-world entity is rejected
 * before it ever reaches persistence.
 */

import { findDuplicateEntities, type ForeverEntityDescriptor } from "@/features/forever-database";

import { importError } from "../result";
import type { ImportIssue } from "../types";

/**
 * Flag records that collide on their natural key within a collection.
 *
 * Detection is delegated to the shared {@link findDuplicateEntities}, so it is
 * deterministic and order-stable. Each colliding natural key yields one
 * blocking `duplicate_entity` error.
 */
export function validateDuplicateEntities<T>(
  entities: readonly T[],
  descriptor: ForeverEntityDescriptor<T>,
  label: string,
): ImportIssue[] {
  return findDuplicateEntities(entities, descriptor).map((key) =>
    importError("duplicate_entity", `Duplicate ${descriptor.tableName} entity: ${key}`, label),
  );
}
