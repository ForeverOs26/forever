# Repository Health Review

Date: 2026-07-08
Reviewer perspective: senior software architect
Scope: repository structure, documentation consistency, duplication, naming consistency, import pipeline, database structure, technical debt, and obsolete files.

## 1. Overall Score

**74 / 100**

Forever is in a healthy early-platform state: the product direction is clear, the main architectural modules are separated, the Supabase migration history is additive, the Import Engine has a repeatable v1 path, and the application builds successfully. The score is held back by stale generated/manual database types, a failing lint/prettier baseline, overlapping documentation, unresolved source-of-truth decisions between compatibility tables and canonical tables, and a few repository hygiene issues.

### Score Rationale

| Area | Score | Notes |
| --- | ---: | --- |
| Product and architecture clarity | 85 | Strong docs and clear One Engine, Many Interfaces direction. |
| Project structure | 82 | Good feature/module separation; some generic names remain. |
| Build health | 82 | Production build passes, with chunk-size and Vite plugin warnings. |
| Lint/format health | 45 | `npm run lint` currently fails with many Prettier errors. |
| Database health | 75 | Additive migration chain and canonical direction are strong; generated types are stale. |
| Import pipeline | 78 | v1 is coherent and idempotent for Modeva; scope is intentionally narrow. |
| Documentation consistency | 72 | Good coverage, but status/validation docs have some overlap and one validation verdict conflicts with later real-run docs. |
| Repository hygiene | 70 | Dual lockfiles, weak root README, generated files, and build/cache folders need policy clarity. |

## 2. Strengths

### Clear Product and Architecture Direction

- The repository consistently describes Forever as a trust and decision layer for real estate, not just a listing website.
- The One Engine, Many Interfaces concept is repeated across architecture, roadmap, blueprint, and project-understanding docs.
- The current architecture separates public UI, project-detail logic, deterministic intelligence, Passport generation, Supabase integration, and import tooling.

### Good Feature-Oriented Source Structure

- `src/features/project-detail` contains a coherent Project Detail Engine with service, query, mappers, types, and section components.
- `src/features/intelligence` is organized into inputs, scoring, rules, verdict, and report generation.
- `src/features/passport` contains Passport types, mapper, serializer, and component code.
- `src/import` is a dedicated import subsystem rather than being mixed into UI code.
- `src/integrations/supabase` isolates Supabase clients and auth-related helpers.

### Safe Database Evolution Pattern

- Migrations are additive and preserve existing website compatibility.
- FDB-001 creates the canonical database direction without removing compatibility tables.
- FDB-002 adds unit price history and Modeva import foundations.
- Modeva migrations and import docs emphasize idempotency and duplicate checks.

### Import Engine v1 Has a Solid Foundation

- Manifest validation, import-status validation, extracted JSON loading, dry-run mode, and database upsert paths are clearly separated.
- Dry-run mode is safe because it stops before creating the Supabase database layer.
- Real-run documentation reports stable Modeva counts and no duplicates.
- The import pipeline follows the Data Standard principle that missing facts should remain missing.

### Build Still Passes

- `npm run build` completed successfully in this environment.
- Build warnings are actionable rather than blocking.

## 3. Weaknesses

### Lint/Formatting Baseline Is Not Healthy

- `npm run lint` fails with 1,062 reported problems, mostly Prettier formatting issues.
- Because Prettier is wired into ESLint, formatting drift currently blocks a clean lint gate.
- This makes future code-review signal weaker because real lint issues are buried under formatting noise.

### Database Types Are Stale or Duplicated

- `src/integrations/supabase/types.ts` does not appear to include the full FDB-001/FDB-002 schema additions such as canonical tables and newer metadata columns.
- `src/lib/database-types.ts` manually mirrors an older database schema and overlaps conceptually with generated Supabase types.
- Multiple type systems now describe overlapping database concepts, which increases risk of false safety in TypeScript.

### Canonical vs Compatibility Data Model Is Unresolved

- Current UI still depends on `projects`, `project_media`, `units`, and `investment_data` display/compatibility paths.
- New canonical structures such as `project_assets`, `documents`, `images`, `videos`, `sources`, `project_intelligence`, `buildings`, and `unit_price_history` are present or planned but not yet primary UI sources.
- This is acceptable during transition, but it needs a written migration strategy before RC1.

### Documentation Is Strong but Overlapping

- Several docs repeat similar status information: current milestone, Modeva validation, Coralina next intake, database status, and Import Engine readiness.
- `docs/VALIDATION_MODEVA.md` ends with `NEEDS FIXES`, while later docs say the real Import Engine run is ready/idempotent. Both can be historically true, but readers need a clearer timeline and supersession note.
- Root `README.md` is too sparse for the repository’s current complexity.

### Import Engine v1 Is Narrow

- Import Engine v1 imports the project/developer/location/building/unit/price-history path.
- It does not yet import canonical source records, documents, media/project assets, project intelligence, or Passport snapshots.
- It has been proven on Modeva, but Coralina will be the first strong repeatability test across a second source package.

### Naming Consistency Is Mixed

- Product docs consistently use Forever language, but code still contains generic starter naming such as package name `tanstack_start_ts`.
- Task IDs use useful prefixes (`FDB`, `FDM`, `RC`), but there is no central index of task ID meanings.
- Some route/component names are product-oriented while some generated/build config names are starter-framework-oriented.

## 4. Technical Debt

### High Priority Debt

1. **Prettier/lint baseline**
   - Current lint output is too noisy to serve as an effective quality gate.
   - Recommendation: run a formatting-only cleanup in a dedicated PR, then keep lint clean.

2. **Regenerate Supabase types**
   - Generated Supabase types should match the current migration chain.
   - Recommendation: regenerate types after confirming the target Supabase schema, then remove or clearly deprecate stale manual DB types.

3. **Canonical data migration plan**
   - The platform needs a staged plan for when UI reads move from compatibility fields/tables to canonical tables.
   - Recommendation: write an RC1 architecture decision record for `project_media` vs `project_assets/documents/images/videos`, `investment_data` vs `project_intelligence`, and display fields vs normalized tables.

4. **Import Engine validation depth**
   - Validation does not yet fully enforce all Data Standard rules at the database level.
   - Recommendation: add standard validation SQL/scripts for counts, duplicates, orphan checks, source coverage, and idempotency.

### Medium Priority Debt

- Root README is insufficient for onboarding.
- Dual lockfiles (`package-lock.json` and `bun.lock`) need a declared package-manager policy.
- Large generated or source-embedded SQL migration for Modeva is hard to review and maintain.
- `routeTree.gen.ts` is generated and should remain policy-protected from manual edits.
- Static content in `src/lib/data.ts` remains mixed with shared presentation types.
- Discovery Compare is partially represented in UI state but remains unresolved as a complete product feature.

### Lower Priority Debt

- Some docs are retrospective validation logs and may eventually move into an archive.
- Some app branding/package names still reflect the starter template rather than Forever.
- Build output warns about a large client chunk and Vite-native tsconfig path support replacing the plugin.

## 5. Duplicate Files

### Exact Duplicate Files

No exact duplicate source or documentation files were identified during this review.

### Duplicate Basenames

- `README.md`
  - `README.md`
  - `src/routes/README.md`
  - This is acceptable because one is repository-level and one is route-convention documentation, but the root README needs expansion.

- `index.ts`
  - `src/import/index.ts`
  - `src/features/passport/index.ts`
  - This is normal barrel-file usage and not a cleanup concern.

### Duplicated Documentation Themes

The following topics are repeated across multiple docs and should be consolidated or cross-linked:

- Current milestone and next Coralina intake:
  - `docs/FOREVER_STATUS.md`
  - `docs/ROADMAP.md`
  - `docs/DATABASE.md`
  - `docs/CODEX_PROJECT_UNDERSTANDING.md`

- Modeva validation/readiness:
  - `docs/VALIDATION_MODEVA.md`
  - `docs/IMPORT_ENGINE_MODEVA_DRY_RUN.md`
  - `docs/IMPORT_ENGINE_MODEVA_REAL_RUN.md`
  - `docs/DATABASE.md`
  - `docs/CHANGELOG.md`

- Architecture overview:
  - `docs/ARCHITECTURE.md`
  - `docs/FOREVER_BLUEPRINT.md`
  - `docs/FOREVER_PRODUCT_SPECIFICATION.md`
  - `docs/CODEX_PROJECT_UNDERSTANDING.md`

This duplication is not harmful yet, but it will become a maintenance risk if status changes are not updated everywhere.

## 6. Obsolete Files

No files should be deleted immediately without a follow-up cleanup task. The following files are candidates for review or policy clarification:

| File or path | Status | Recommendation |
| --- | --- | --- |
| `src/lib/database-types.ts` | Likely stale manual DB type mirror | Replace with regenerated Supabase types or mark as legacy. |
| `src/integrations/supabase/types.ts` | Generated but stale relative to migrations | Regenerate from the current Supabase schema. |
| `README.md` | Obsolete as onboarding material | Replace with useful project setup and architecture entry points. |
| `docs/VALIDATION_MODEVA.md` | Historically useful but superseded in parts by real-run validation | Add a supersession note pointing to the real-run doc. |
| `package-lock.json` and `bun.lock` together | Ambiguous package-manager policy | Pick one canonical package manager or document why both are required. |
| `supabase/migrations/20260707105000_fdb002c_import_modeva_units.sql` | Valid migration, but heavy embedded source payload | Keep for migration history; prefer generated/import-engine source packages for future projects. |
| `.pnpm-store/` and `supabase/.temp/` directories | Local/cache folders visible in workspace | Ensure ignored and not accidentally committed. |

## 7. Documentation Issues

### Root README Is Underdeveloped

The root README currently does not explain:

- What Forever is.
- How to install dependencies.
- How to run development server/build/lint.
- How Supabase is configured.
- How import commands work.
- Which docs to read first.

### Status Docs Need a Single Source of Truth

Recommended documentation hierarchy:

1. `docs/FOREVER_STATUS.md` — current truth only.
2. `docs/ROADMAP.md` — forward-looking phases only.
3. `docs/CHANGELOG.md` — immutable historical milestones.
4. Import validation docs — immutable run logs with clear supersession notes.
5. `docs/ARCHITECTURE.md` — canonical technical overview.
6. `docs/DATA_STANDARD.md` — canonical data/import contract.

### Validation Timeline Needs Clarification

`docs/VALIDATION_MODEVA.md` says the final verdict is `NEEDS FIXES` because live database validation was not executed during that milestone. Later Import Engine real-run docs say Modeva is ready/idempotent after live validation. Add a short note to the older validation doc so readers understand it has been superseded by the later real-run validation.

### Import Package Location Is Documented but Missing in Repo Snapshot

Docs repeatedly reference `forever-data/projects/{project_slug}/`, but the reviewed repository file list did not show committed `forever-data` project packages. This may be intentional if source materials are private/untracked, but the policy should be explicit.

## 8. Architecture Risks

### Dual Source-of-Truth Risk

The largest architecture risk is the coexistence of compatibility display tables/fields and canonical normalized tables without a committed migration plan. If this continues too long, future features may read/write different sources and drift.

### Stale Type Safety Risk

If generated Supabase types are stale, TypeScript may not catch mismatches between importer/database code and the real database schema. This is especially risky for service-role import paths.

### Import Repeatability Risk

Modeva proves the first path, but one successful project can hide assumptions about file structure, extracted JSON shape, source naming, price-list format, and unit/building derivation. Coralina should be treated as a formal repeatability test.

### Evidence and Claims Risk

Forever’s product promise depends on source-backed verification. Public UI and Intelligence copy must stay aligned with what is actually stored and traceable. Avoid claims that imply legal, construction, or pricing verification where source-backed fields are absent.

### Bundle Growth Risk

The production build currently warns about a client chunk above 500 kB. This is not urgent, but future Intelligence, Passport, PDF, admin, and tablet features could increase bundle size if code splitting is not actively managed.

### Generated/Build Artifact Risk

Generated files and local build/cache folders are present in the workspace ecosystem. The repository needs clear ignore and editing policies for generated route trees, build output, Supabase temp files, and package-manager caches.

## 9. Recommended Priorities

### P0 — Keep the Branch Safe

- Continue avoiding history rewrites because this repository is connected to Lovable.
- Keep source code, migrations, and UI stable while documentation and intake planning continue.

### P1 — Restore Quality Gates

1. Run a dedicated formatting cleanup PR to make `npm run lint` pass.
2. Keep lint passing after the cleanup.
3. Add a lightweight CI/checklist expectation for build and lint.

### P1 — Fix Database Type Alignment

1. Regenerate `src/integrations/supabase/types.ts` from the current Supabase schema.
2. Decide whether `src/lib/database-types.ts` remains useful or becomes legacy.
3. Add a documented command for type regeneration to the root README or setup doc.

### P1 — Freeze RC1 Architecture Decisions

Create short architecture decision records for:

- Canonical media/document flow.
- Project intelligence persistence vs on-demand generation.
- Passport snapshot strategy.
- Display fields vs normalized tables.
- Discovery Compare scope.

### P2 — Prove Import Engine Repeatability

1. Use Coralina as the second-project import test.
2. Run dry-run before real import.
3. Document all validation issues without guessing absent facts.
4. Add reusable validation scripts/checklists for counts, duplicates, orphan records, and idempotency.

### P2 — Clean Documentation Navigation

1. Expand root README into a real onboarding entry point.
2. Add supersession notes to historical validation docs.
3. Consolidate current status into `FOREVER_STATUS.md` and make other docs link to it instead of repeating volatile status.

### P3 — Improve Repository Hygiene

1. Decide package-manager policy for npm vs Bun.
2. Confirm `.pnpm-store/`, `.output/`, `.wrangler/`, `supabase/.temp/`, and other local artifacts are ignored.
3. Rename package metadata from starter-template naming to Forever when safe.
4. Consider archiving older one-off validation docs after the import intake process stabilizes.
