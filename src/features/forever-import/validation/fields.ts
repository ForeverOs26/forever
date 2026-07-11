/**
 * Forever Import — field-level validation.
 *
 * Guards that run over individual records before they are assembled into
 * canonical entities: required fields must be present, and every entity in a
 * collection must carry a unique, non-empty id. All checks return issues; none
 * throw.
 */

import { importError } from "../result";
import type { ImportIssue } from "../types";

function joinPath(label: string | undefined, field: string): string {
  return label ? `${label}.${field}` : field;
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

/**
 * Ensure every named field is present on a record.
 *
 * A field is absent when it is `undefined`, `null`, or an empty/whitespace
 * string. Each missing field yields one blocking `missing_required_field`
 * error located at `<label>.<field>`.
 */
export function validateRequiredFields(
  value: Record<string, unknown>,
  required: readonly string[],
  label?: string,
): ImportIssue[] {
  const issues: ImportIssue[] = [];
  for (const field of required) {
    if (!isPresent(value[field])) {
      issues.push(
        importError(
          "missing_required_field",
          `Required field "${field}" is missing`,
          joinPath(label, field),
        ),
      );
    }
  }
  return issues;
}

/**
 * Ensure every entity in a collection has a unique, non-empty id.
 *
 * Missing ids raise `missing_entity_id`; a repeated id raises
 * `duplicate_entity_id` on the second and later occurrences. Both are blocking
 * — a collection cannot be persisted with an ambiguous primary key.
 */
export function validateEntityIds<T extends { id?: unknown }>(
  entities: readonly T[],
  label: string,
): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();
  entities.forEach((entity, index) => {
    const id = entity.id;
    if (typeof id !== "string" || id.trim().length === 0) {
      issues.push(
        importError("missing_entity_id", `Entity is missing a valid id`, `${label}.${index}.id`),
      );
      return;
    }
    if (seen.has(id)) {
      issues.push(
        importError("duplicate_entity_id", `Duplicate entity id "${id}"`, `${label}.${index}.id`),
      );
      return;
    }
    seen.add(id);
  });
  return issues;
}
