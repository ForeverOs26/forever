/**
 * Forever Sync — payload validation.
 *
 * The canonical records a sync would move are validated by delegating to the
 * Forever Import (RC3.1) pipeline: entity ids, natural-key duplicates, and
 * referential integrity are checked by the exact same rules that guard an
 * import. This is deliberate reuse — a synced record and an imported record
 * are the same canonical entity, so they must satisfy the same guarantees.
 */

import { validateImport, type ImportBatch, type ReferenceScope } from "@/features/forever-import";

import type { SyncIssue } from "../types";

/**
 * Validate a sync payload against the RC3.1 import rules.
 *
 * Returns the issues verbatim: an {@link import("@/features/forever-import").ImportIssue}
 * is structurally a {@link SyncIssue} (they share the same severity vocabulary),
 * so no translation is needed and no rule is re-implemented here.
 */
export function validateSyncPayload(payload: ImportBatch, scope: ReferenceScope = {}): SyncIssue[] {
  return validateImport(payload, scope).issues;
}
