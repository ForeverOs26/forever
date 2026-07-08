# Forever Database

## Forever Core Database

FDB-001 introduced the first production-ready Forever Core Database foundation using additive Supabase migrations.

The foundation preserves current website compatibility while preparing the platform for structured imports, project intelligence, canonical assets, and future interfaces.

## Existing Tables

Existing tables kept intact:

- `developers`
- `locations`
- `projects`
- `units`
- `project_media`
- `investment_data`
- `leads`

Other existing support tables include translations, tags, amenities, nearby places, project SEO, status history, and price updates.

## Canonical Tables

FDB-001 added or prepared canonical tables for future structured data:

- `buildings`
- `project_assets`
- `documents`
- `images`
- `videos`
- `facilities`
- `project_facilities`
- `sources`
- `project_intelligence`
- `audit_log`

FDB-001 also added compatibility metadata to existing core tables, including project location references and project/developer/location metadata fields.

FDB-002 added Modeva import prerequisites and validated the first complete unit inventory import.

FDB-003 added the reusable Forever Import Engine v1 for repeatable imports from `forever-data/projects/`.

## Import Workflow

Project source material lives under:

```text
forever-data/projects/{project_slug}/
```

Each project must include:

```text
manifest.json
import-status.json
extracted/
source/
README.md
```

The manifest describes the project identity and expected source folders. `import-status.json` confirms readiness. Extracted JSON files provide structured facts. Source files are reviewed before import. Missing facts are not imported.

Current Modeva source folders:

- `brochure`
- `price-list`
- `unit-plans`
- `furniture-package`
- `map`
- `perspective`
- `show-unit-photos`
- `video`

Import Engine v1 workflow:

```text
Read manifest
Validate project
Load extracted JSON
Connect Supabase
Upsert developer
Upsert location
Upsert project
Upsert buildings
Upsert units
Upsert price history
Return summary
```

Current command pattern:

```powershell
npm run import modeva -- --dry-run
npm run import modeva
```

## Current Database Status

- FDB-001 is complete.
- FDB-002 Modeva import foundation is complete.
- FDB-003 Import Engine v1 is approved.
- Modeva remains validated at 7 buildings, 289 units, and 289 unit price history rows.
- No duplicate Modeva units or duplicate Modeva price history rows were found after the real Import Engine idempotency run.
- Supabase generated types have not been regenerated after FDB-001.
- Current website queries remain compatible with existing tables.
- New canonical tables are not yet connected to the UI.

## Next Recommended Intake

Coralina should use the same pipeline:

1. Create `forever-data/projects/coralina/`.
2. Add manifest and source folders.
3. Generate `import-status.json`.
4. Extract brochure and price-list JSON.
5. Run dry-run validation.
6. Run real import only after dry-run passes.
