# Forever Import Engine Architecture

Task ID: RC3-001

Status: Initial production-ready architecture skeleton

## Purpose

The Forever Import Engine imports one validated project package from `forever-data/projects/{project_slug}/` into the Forever database. It is reusable for every Forever project and must keep missing facts missing, reject incomplete packages, support dry-run planning, and prepare database writes without importing unless explicitly executed.

## Folder Structure

```text
src/import/
  cli.ts                 CLI entrypoint
  manifest.ts            Manifest loading and shape validation
  validator.ts           Package/readiness/source validation
  datasets.ts            Extracted dataset loading
  planner.ts             Deterministic import-plan creation
  plan-validator.ts      Relationship and duplicate validation
  state-machine.ts       Import lifecycle transitions
  rollback.ts            Rollback contract and skeleton
  database.ts            Supabase insertion/upsert layer
  importer.ts            Pipeline orchestrator
  types.ts               Shared interfaces and error/state model
```

Project packages use:

```text
forever-data/projects/{project_slug}/
  manifest.json
  import-status.json
  extracted/
  source/
```

## Import Pipeline

1. Initialize execution context.
2. Read `manifest.json`.
3. Validate manifest and package readiness.
4. Load supported extracted datasets.
5. Create an import plan with developer, location, project, building, unit, and price-history operations.
6. Validate plan relationships.
7. In dry-run mode, return counts and operations without creating a Supabase client.
8. In execute mode, run the database insertion layer.
9. If execution fails, enter rollback state and use the rollback contract.
10. Return an import summary.

## Validation Pipeline

Validation is layered:

- Manifest shape: required metadata, manifest format, supported version.
- Package readiness: `import-status.json`, required folders, required files, extracted JSON.
- Metadata safety: blocks `SOURCE_PENDING` and empty required manifest fields.
- Dataset loading: parse JSON or fail loudly on invalid JSON.
- Relationship validation: duplicate units, duplicate price-history source keys, orphan unit/building links, orphan price-history/unit links.

Validation issues use a shared model:

```ts
{
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  path?: string;
}
```

## Import Plan

The import plan is the durable boundary between validation and database execution. It contains:

- Manifest and validation report.
- Loaded datasets.
- Normalized project facts.
- Payloads for developer, location, project, buildings, units, and price history.
- Ordered operations with natural keys and dependencies.
- Rollback plan.

## Database Insertion Layer

`database.ts` remains the only module allowed to create a Supabase import client or perform writes. Dry-run mode never creates the client. The current layer upserts developer, location, project, buildings, units, and unit price history.

Future versions should add transaction-scoped execution and canonical source/media/document/intelligence insertion without changing the import-plan boundary.

## Rollback Strategy

Dry-run requires no rollback.

Execute mode creates a compensating rollback plan in reverse dependency order. The current skeleton records rollback intent and keeps writes idempotent; it does not auto-delete or mutate rows until transaction support and audit snapshots are added.

Preferred v2 rollback:

- Wrap each import in a database transaction or RPC.
- Capture prior row snapshots for every upsert.
- On failure, restore previous rows and delete newly inserted rows.
- Write an immutable audit record for completed or rolled-back imports.

## Import State Machine

```text
initialized
  -> manifest_loaded
  -> package_validated
  -> datasets_loaded
  -> plan_created
  -> relationships_validated
  -> dry_run_completed -> completed
  -> executing -> completed
  -> executing -> rolling_back -> rolled_back -> failed
```

Any state may fail only through explicit allowed transitions in `state-machine.ts`.
