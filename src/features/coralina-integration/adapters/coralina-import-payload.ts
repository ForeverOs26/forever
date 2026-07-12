/**
 * Coralina import payload (RC3.1).
 *
 * Assembles the deterministic import payload for Coralina using the Forever
 * Import contracts: an {@link ImportSource} descriptor, an {@link ImportContext},
 * an {@link ImportBatch} of canonical entities, and a {@link ReferenceScope} that
 * resolves the project's location foreign key.
 *
 * This performs no extraction. There is no PDF/OCR/Excel parsing, no file
 * reading, and no network access — the batch is built entirely from the already
 * verified canonical record produced by {@link buildCoralinaRecord}. The
 * `ImportContext` deliberately omits `defaultCurrency`: the source states no
 * currency, so the payload never carries one.
 */

import type {
  ImportBatch,
  ImportContext,
  ImportSource,
  ImportValidation,
  ReferenceScope,
} from "@/features/forever-import";
import { validateImport } from "@/features/forever-import";

import { CORALINA_BROCHURE_SOURCE_FILE } from "../data";
import { CORALINA_LOCATION_ID } from "../identity";
import { buildCoralinaRecord } from "./coralina-canonical";

/** The complete, self-contained Coralina import payload. */
export interface CoralinaImportPayload {
  source: ImportSource;
  context: ImportContext;
  batch: ImportBatch;
  scope: ReferenceScope;
}

/** Static descriptor of where the Coralina payload comes from. */
export const CORALINA_IMPORT_SOURCE: ImportSource = {
  id: "coralina_source_package",
  kind: "project",
  format: "manual",
  label: "Coralina developer source package",
  origin: CORALINA_BROCHURE_SOURCE_FILE,
};

/**
 * Build the Coralina import payload from the canonical record.
 *
 * The batch carries the project, its 198 units, its media, and its documents.
 * `developers` is intentionally absent (no verified developer). The scope makes
 * the project's `locationId` resolvable so referential validation passes.
 */
export function buildCoralinaImportPayload(): CoralinaImportPayload {
  const record = buildCoralinaRecord();
  const batch: ImportBatch = {
    projects: [record.project],
    units: record.units,
    media: record.media,
    documents: record.documents,
  };
  return {
    source: CORALINA_IMPORT_SOURCE,
    context: { source: CORALINA_IMPORT_SOURCE },
    batch,
    scope: { locationIds: new Set([CORALINA_LOCATION_ID]) },
  };
}

/**
 * Validate a Coralina import payload with the RC3.1 pipeline (id validity,
 * duplicate detection, referential integrity). Pure — never throws.
 */
export function validateCoralinaImportPayload(
  payload: CoralinaImportPayload = buildCoralinaImportPayload(),
): ImportValidation {
  return validateImport(payload.batch, payload.scope);
}
