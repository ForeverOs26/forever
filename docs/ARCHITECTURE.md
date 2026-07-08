# Forever Architecture

## Forever Blueprint

Forever exists to reduce uncertainty in real estate decisions.

The platform is designed around One Engine, Many Interfaces: the same structured project data, Passport, and Intelligence layers should support the website, Tablet Booth Mode, CRM, PDF reports, investor reports, and future mobile interfaces.

## System Architecture

Forever currently consists of:

- React/TanStack frontend routes.
- Supabase-backed project and lead data.
- Project Detail Engine for reusable project pages.
- Deterministic Forever Intelligence module.
- Forever Passport module for canonical project summaries.
- Source-material standards under `forever-data/projects`.

## Main Modules

- `src/lib/project-service.ts`
  - Existing catalog/listing data layer.

- `src/features/project-detail`
  - Universal Project Detail Engine, service, mappers, and section components.

- `src/features/intelligence`
  - Deterministic scoring, rules, verdict, and report generation.

- `src/features/passport`
  - Canonical Forever Passport types, mapper, serializer, and UI card.

- `src/features/discovery`
  - Discovery filtering, search, and sorting utilities.

- `supabase/migrations`
  - Database schema evolution.

- `forever-data/projects`
  - Verified project source-material intake and manifest standard.

## Development Principles

- Keep absent facts absent.
- Do not infer project data from other projects.
- Prefer deterministic, explainable logic.
- Keep ProjectService stable unless explicitly refactoring it.
- Preserve backward compatibility with current public routes.
- Add database changes through migrations only.
- Keep source materials separate from application code.

## Single Source of Truth

The long-term source of truth is the Forever Core Database, supported by verified project source files and per-project manifests.

Current compatibility layers remain in place:

- `project_media` supports the existing website media flow.
- `investment_data` supports the current Project Detail Engine.
- New canonical tables prepare the system for future imports.

## Architecture Freeze RC1

Before RC1, the team should freeze decisions for:

- Canonical media flow.
- Project intelligence persistence.
- Passport snapshot strategy.
- Project import package validation.
- Discovery Compare scope.
- Relationship between normalized database tables and current UI display fields.
