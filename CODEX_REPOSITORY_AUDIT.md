# Codex Repository Audit

## 1. Current Project Structure Overview

Forever is a React and TypeScript real estate decision platform built with TanStack Start, Vite, and Supabase. The repository is organized into application code, database migrations, structured project source data, and product/engineering documentation.

Top-level structure:

- `src/` - application source code.
- `src/routes/` - TanStack Router route files for public pages such as Home, Projects, Discovery, Contact, and Project Detail.
- `src/components/` - shared UI components, layout components, forms, cards, and UI primitives.
- `src/features/` - domain modules for Discovery, Forever Intelligence, Forever Passport, and Project Detail.
- `src/integrations/supabase/` - Supabase clients, middleware helpers, and generated/maintained database types.
- `src/import/` - Forever Import Engine for validating and importing structured project data.
- `supabase/` - Supabase configuration and additive database migrations.
- `forever-data/` - canonical project source materials, manifests, extracted data, import status, and reports.
- `docs/` - product, architecture, database, setup, roadmap, data standard, and validation documentation.
- `public/` - static public assets.

## 2. Main Architecture Layers

The current architecture separates the product into several clear layers:

1. Presentation layer
   - React components and route files render the public website experience.
   - Project cards, detail pages, Passport UI, Intelligence UI, Discovery, and contact flows live here.

2. Feature/domain layer
   - `project-detail` provides the reusable Project Detail Engine.
   - `passport` converts project and intelligence data into a canonical Forever Passport.
   - `intelligence` produces deterministic, explainable project scoring and recommendations.
   - `discovery` handles client-side filtering/search/sort behavior for the discovery experience.

3. Data/service layer
   - Supabase clients connect the application to the deployed database.
   - Project detail and related services map database records into UI-ready view models.

4. Import/data operations layer
   - `src/import/` reads project manifests, validates project folders, prepares payloads, and upserts structured data.
   - `forever-data/projects/` is the file-based source-of-truth intake area for project materials before database import.

5. Documentation/governance layer
   - `docs/` captures product strategy, setup, database structure, data standards, import validation, and roadmap state.

## 3. Supabase / Database Layer Summary

Supabase is the backend and persistence layer. Database changes are managed through migrations in `supabase/migrations/`.

The database currently includes:

- Existing website/project tables such as `projects`, `developers`, `locations`, `units`, `project_media`, `investment_data`, and `leads`.
- Forever Core Database additions including `buildings`, `project_assets`, `documents`, `images`, `videos`, `facilities`, `project_facilities`, `sources`, `project_intelligence`, `audit_log`, and `unit_price_history`.
- Additive Modeva seed/import migrations for Developer `Title`, Location `Bang Tao`, Project `Modeva`, 7 buildings, 289 units, and 289 unit price history rows.

The migration strategy is additive and backward-compatible. Existing tables are preserved rather than reset or replaced.

## 4. Import Pipeline Summary

The Forever Import Engine lives in `src/import/` and is designed to eliminate manual project imports.

Main files:

- `manifest.ts` - loads and validates `manifest.json`.
- `validator.ts` - validates source folders, required assets, import status, and extracted JSON.
- `database.ts` - provides reusable Supabase upsert helpers for developers, locations, projects, buildings, units, and price history.
- `importer.ts` - orchestrates the full import workflow.
- `logger.ts` - standardizes console output.
- `cli.ts` - supports commands such as `npm run import modeva` and dry-run mode.
- `index.ts` - exports the public import API.

Project source data follows the standard structure under `forever-data/projects/<project-slug>/`, including:

- `manifest.json`
- `import-status.json`
- `README.md`
- `source/`
- `extracted/`

Modeva is the first validated/imported project. Coralina has an intake structure but is currently not ready for import.

## 5. Risks or Inconsistencies Noticed

- Supabase TypeScript types may lag behind newer additive migrations if types are not regenerated after database changes.
- The application now has both legacy website tables and newer canonical Forever Core Database tables, so clear ownership rules are important.
- Some project data still depends on extracted JSON and manual source material classification before import can be trusted.
- The import engine and migration-imported Modeva data need to remain idempotent as the import workflow evolves.
- Public UI, Passport, Intelligence, and Import Engine all depend on overlapping project concepts; field naming drift could become a scalability risk.
- `.env` exists locally, which is normal for development, but it must remain ignored and never be committed.
- Generated/build folders such as `.output`, `.wrangler`, and `node_modules` are present locally and should remain out of source control.

## 6. Recommended Next Steps

1. Regenerate or review Supabase TypeScript types after confirming the deployed schema is final for the current milestone.
2. Continue using additive migrations only; do not reset or rewrite existing database history.
3. Keep `forever-data/projects/` as the canonical intake standard for future projects such as Coralina, Katabello, and RainPalm.
4. Run the Import Engine on future projects in dry-run mode before any real import.
5. Define a clear compatibility map between legacy project fields and the Forever Core Database schema.
6. Add lightweight automated validation for project manifests, extracted JSON, and import-status files.
7. Keep UI-facing engines, especially Passport and Intelligence, consuming stable view models rather than raw database rows.
8. Maintain documentation updates after each database/import milestone so the repository remains understandable as the platform grows.
