/**
 * Modeva knowledge identity — deterministic, caller-stated constants.
 *
 * The RC4.4–RC4.9 foundations never read a wall clock; every timestamp they
 * stamp comes from the caller. The two instants below are stated clock
 * values, both anchored to committed repository facts rather than to "now":
 *
 * - the extraction instant is the validation date both committed Modeva
 *   verification reports record (`docs/VALIDATION_MODEVA.md` and
 *   `docs/IMPORT_ENGINE_MODEVA_REAL_RUN.md` → "Validation date: 2026-07-08"),
 * - the description instant is the day this definition was authored.
 *
 * Rebuilding the definition therefore always yields byte-identical artifacts.
 */

export const MODEVA_SLUG = "modeva";
export const MODEVA_PROJECT_ID = "proj_modeva";

/** The validation date both committed Modeva verification reports record. */
export const MODEVA_KNOWLEDGE_EXTRACTED_AT = "2026-07-08T00:00:00.000Z";

/** This definition's stated description clock (constant, so the build is reproducible). */
export const MODEVA_KNOWLEDGE_DESCRIBED_AT = "2026-07-12T00:00:00.000Z";

/** Committed artifacts every Modeva statement is transcribed from, for citation. */
export const MODEVA_DATASETS = {
  canonicalSeed: "supabase/migrations/20260707103000_fdb001_seed_title_bang_tao_modeva.sql",
  priceListImport: "supabase/migrations/20260707105000_fdb002c_import_modeva_units.sql",
  importValidation: "docs/VALIDATION_MODEVA.md",
  realRunReport: "docs/IMPORT_ENGINE_MODEVA_REAL_RUN.md",
} as const;
