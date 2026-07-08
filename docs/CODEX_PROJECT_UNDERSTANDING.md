# Codex Project Understanding

Date: 2026-07-08

## 1. Project Purpose

Forever is a verified real-estate decision platform for Phuket property projects. Its core purpose is to reduce buyer uncertainty by turning developer/source material into structured project data, reusable project pages, explainable intelligence, and a canonical Forever Passport.

The strategic architecture is **One Engine, Many Interfaces**: the same source-backed database records, Project Detail Engine, Passport, and Intelligence layers should eventually support the public website, Tablet Booth Mode, CRM workflows, PDF/investor reports, mobile interfaces, and a future Knowledge Engine.

The product standard is deliberately conservative: absent facts stay absent, imported facts must be source-backed, and recommendations must be explainable rather than inferred from unstored assumptions.

## 2. Current Architecture

### Application Stack

- React 19 frontend using TanStack Router / TanStack Start.
- Vite-based build tooling.
- Supabase as the application database and authentication/storage integration point.
- Tailwind/Radix-style UI component primitives under `src/components/ui`.
- Lovable-connected repository; published branch history should not be rewritten.

### Frontend Route Layer

The public website is organized under `src/routes` with routes for:

- Home.
- Projects listing.
- Project detail pages by slug.
- Discovery.
- Areas.
- Offers.
- Reviews.
- About.
- Contact.
- Sitemap.

### Data Access Layers

The current codebase has two main project data paths:

1. **Catalog/listing data layer**
   - `src/lib/project-service.ts`
   - Fetches active projects from Supabase.
   - Maps project rows, developers, and `project_media` into the app-wide `Property` display model.
   - Supports listing, featured listings, individual project fetches, and sitemap slug enumeration.

2. **Project Detail data layer**
   - `src/features/project-detail/project-detail-service.ts`
   - Fetches project detail records with developer, media, units, and investment data.
   - Maps database rows into the reusable Project Detail Engine model.

### Project Detail Engine

`src/features/project-detail` contains the reusable project-detail architecture:

- Detail query/service.
- Type definitions.
- Mappers.
- Section components for hero, gallery, developer, trust summary, documents, floor plans, unit plans, master plan, investment analysis, intelligence, and contact CTA.

This is the current basis for reusable project storytelling across projects.

### Forever Intelligence

`src/features/intelligence` contains deterministic scoring and rules:

- Trust score.
- Investment score.
- Rental score.
- Location score.
- Liquidity score.
- Construction risk score.
- Strength, weakness, and risk rules.
- Verdict calculation.
- Report generation.

The current intelligence layer is not AI-driven. It is deterministic, explainable, and based on structured project data.

### Forever Passport

`src/features/passport` creates a canonical project summary from Project Detail data and the generated Intelligence report. It includes:

- Passport types.
- Project-to-passport mapper.
- Serializer.
- Passport UI card.

The Passport is intended to become the canonical project identity layer used across website, tablet, CRM, PDF, investor report, and mobile interfaces.

### Discovery

`src/features/discovery` contains filtering, search, and sorting utilities used by the Discovery experience. Discovery is functional, but compare behavior remains an RC1 decision point.

### Import Engine

`src/import` contains Import Engine v1:

- CLI entrypoint.
- Manifest loading and shape validation.
- Project import validation.
- Extracted JSON loading.
- Project fact extraction.
- Unit/price-list mapping.
- Building derivation.
- Supabase database upsert layer.
- Dry-run support.
- Import logging and summaries.

The import pipeline expects source packages under `forever-data/projects/{project_slug}/` with manifest, import-status, extracted JSON, source folders, and README.

### Database Layer

Supabase migrations under `supabase/migrations` show an additive database evolution:

- Initial developers/projects/units/media/investment foundations.
- UI display fields and seed data.
- Translations, tags, amenities, nearby places, SEO, status history, price updates, storage policies, and leads.
- FDB-001 canonical database additions: developer/location metadata, sources, audit log, buildings, facilities, project assets, documents, images, videos, and project intelligence.
- FDB-002 Modeva import prerequisites and unit price history.
- FDB-002C Modeva building/unit/price-history import migration.

The database is currently in a compatibility phase: existing public routes still depend on current display-oriented tables and fields, while normalized canonical tables prepare the platform for repeatable verified imports and future interfaces.

## 3. Current Milestone

The current milestone is **Import Engine v1 approved and ready for the next verified project intake**.

Completed milestone evidence includes:

- FDB-001 Forever Core Database foundation.
- FDB-002 Modeva extraction, import prerequisites, unit import migration, and validation.
- FDB-003A Import Engine v1 implementation.
- FDB-003B Modeva dry-run pass.
- FDB-003C Modeva real import/idempotency pass.
- FDM-001 Modeva source material folder structure.
- FDM-002 Forever project import manifest standard.

The active operational task is preparing Coralina source intake using the same folder, manifest, extraction, validation, and Import Engine pipeline.

## 4. Database Status

The database foundation is substantially advanced but not fully connected to the UI.

Current status:

- FDB-001 is complete as additive, backward-compatible Supabase migrations.
- Existing public website compatibility is preserved.
- Modeva is validated at:
  - 7 buildings.
  - 289 units.
  - 289 unit price history rows.
- Import Engine v1 has passed real idempotency validation for Modeva.
- No duplicate Modeva units or duplicate Modeva price-history rows were found after the real idempotency run.
- New canonical tables exist or are prepared, but are not yet the primary UI data source.
- Supabase generated TypeScript types have not yet been regenerated after the FDB-001 schema expansion.

Important architectural tension:

- Current UI relies heavily on `projects`, `project_media`, `units`, and `investment_data` display/compatibility structures.
- The future platform model points toward normalized canonical tables such as `buildings`, `project_assets`, `documents`, `images`, `videos`, `sources`, `project_intelligence`, and `audit_log`.

## 5. Import Engine Status

Import Engine v1 is approved and usable for the next verified intake.

What it currently does well:

- Loads and validates a project manifest.
- Validates `import-status.json` and required source folders/files.
- Reads `extracted/brochure.json` and `extracted/price-list.json` when present.
- Maps extracted price-list rows into unit records.
- Derives building records from unit inventory.
- Normalizes price-list dates and availability status.
- Supports dry-run mode without creating a Supabase client or performing writes.
- Upserts developer, location, project, buildings, units, and unit price history.
- Handles Modeva idempotently with stable counts.

Current limitations:

- It imports the core project/developer/location/building/unit/price-history path only.
- It does not yet import canonical media, documents, source records, project assets, project intelligence, or Passport snapshots.
- It relies on extracted JSON existing ahead of time; OCR/document extraction is outside v1.
- It does not yet enforce all Data Standard validation rules at database level.
- It has been validated deeply against Modeva, but Coralina will be the first repeat-project proof after Modeva.

## 6. Next Recommended Milestone

The next recommended milestone is **Coralina Source Intake and Dry-Run Validation**.

Recommended scope:

1. Create `forever-data/projects/coralina/` using the official folder structure.
2. Add `manifest.json`, `import-status.json`, `README.md`, `source/`, and `extracted/`.
3. Classify Coralina source files into standard folders.
4. Extract brochure data into `extracted/brochure.json`.
5. Extract price-list data into `extracted/price-list.json`.
6. Run Import Engine dry-run.
7. Resolve validation issues without guessing missing facts.
8. Run real import only after dry-run passes.
9. Document the Coralina validation result the same way Modeva was documented.

Parallel RC1 architecture work should freeze:

- Canonical media flow.
- Project intelligence persistence strategy.
- Passport snapshot strategy.
- Relationship between display fields and normalized canonical tables.
- Discovery Compare scope.

## 7. Risks

### Data and Import Risks

- Coralina may expose assumptions hidden by Modeva-specific source formats.
- Missing or inconsistent source files could tempt manual inference; the Data Standard explicitly forbids guessing.
- Extracted JSON shape may drift unless kept aligned with Import Engine expectations.
- Import Engine v1 has limited document/media/intelligence ingestion, so source package completeness may exceed what the importer currently persists.

### Database Risks

- Supabase generated types are stale after recent schema expansion.
- Canonical tables are present but not yet connected to UI, creating dual-model risk between display fields and normalized data.
- Some idempotency protections are implemented in importer logic and selected indexes, but future imports may need stronger database-level constraints.
- Project assets/documents/media overlap is unresolved and could create duplicate source-of-truth paths.

### Product/UX Risks

- RC0 is safe for guided real-client testing, but RC1 still needs compare completion/removal, loading/empty states, mobile QA, and project detail story-flow refinement.
- Public website copy and UI may imply more verification depth than the current persisted canonical data supports unless kept carefully aligned.

### Operational Risks

- The repository is Lovable-connected, so rewriting published branch history can disrupt the user’s Lovable project history.
- Environment differences have already appeared around `npm` availability and direct runtime invocation.
- Real imports require correct Supabase environment variables and careful secret handling.

## 8. Recommendations

### Immediate Recommendations

- Use Coralina as the repeatability test for Import Engine v1.
- Keep Modeva as the reference/golden import package and validation benchmark.
- Do not extend UI or migrations during Coralina source intake unless a blocker is found and explicitly approved.
- Regenerate Supabase TypeScript types after schema changes are confirmed in the target environment.

### Architecture Recommendations

- Decide the canonical media/document path before importing richer source packages at scale.
- Decide whether project intelligence should be generated on request, persisted in `project_intelligence`, or snapshotted as part of Passport generation.
- Define the boundary between UI display fields and normalized tables before RC1.
- Add importer coverage for `sources`, `project_assets`, `documents`, and eventually `project_intelligence` in Import Engine v2.

### Database Recommendations

- Consider additive unique constraints for unit identity where safe, especially around `(project_id, unit_code)`.
- Keep import idempotency documented and tested for every project.
- Add standard SQL validation scripts for counts, duplicates, orphan records, and source coverage.
- Keep all schema changes migration-only and backward-compatible until the public UI is fully migrated to canonical tables.

### Product Recommendations

- Complete or remove Discovery Compare before RC1.
- Improve loading and empty states.
- Perform real-device mobile QA.
- Refine Project Detail story flow around source-backed trust, price evidence, Passport, and Intelligence.
- Maintain clear public language: deterministic Intelligence is explainable rules-based logic, not active AI.

### Documentation Recommendations

- Keep `FOREVER_STATUS.md`, `ROADMAP.md`, `DATABASE.md`, and Import Engine validation docs updated after every intake milestone.
- Create a standard intake report template for Coralina and all future projects.
- Track every imported fact back to source file/page/sheet/row where available.
